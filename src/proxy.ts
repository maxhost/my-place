import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { lookupPlaceByDomain } from "@/shared/lib/custom-domain-lookup";
import { resolveHostWithCustomDomains } from "@/shared/lib/host-routing";
import {
  buildContentSecurityPolicy,
  CSP_HEADER,
  generateNonce,
  NONCE_HEADER,
} from "@/shared/lib/security/content-security-policy";

// Proxy host-based (Next 16 renombra middleware→proxy, ADR-0013). Clasifica el
// host (ADR-0005 §10 · multi-tenancy.md) y:
//   - marketing → delega en el middleware i18n de next-intl (apex con
//     `[locale]`); el i18n NO se duplica, se integra.
//   - inbox → **compone** intl + rewrite a `/inbox/{locale}/...`. El i18n vive
//     también en la zona Hub: pattern oficial next-intl "Composing other
//     middleware" (S5a del Hub). intl corre primero (resuelve locale + agrega
//     prefix vía 302 si falta + setea cookie `NEXT_LOCALE`); si redirigió,
//     propagamos el redirect tal cual (la cookie y los headers viajan con él);
//     si pasó (200/next), aplicamos el rewrite al prefix interno `/inbox/`
//     PROPAGANDO cookies y headers `x-*` que intl pudo setear (sin ellos,
//     `getTranslations({locale})` en el page server no resuelve el locale
//     correcto).
//   - place → rewrite a `/place/{slug}{path}` (prefijo estático: evita la
//     colisión `[locale]`↔`[placeSlug]` que Next prohíbe en route groups).
//   - custom-domain → rewrite a `/place/{slug}{path}` IDÉNTICO al place pero
//     sin componer intl. Feature B (ADR-0031 §3, 2026-05-22): el host custom
//     (ej. `nocodecompany.co`) se resolvió contra `place_domain` verified vía
//     `lookupPlaceByDomain` (SECURITY DEFINER, migration 0009/S1, wrapper TS
//     S2). En custom domain el locale viene de `place.default_locale`
//     (resuelto por la page tree con `<html lang>` derivado en el layout),
//     NO del path prefix `/[locale]` — el visitor ve `nocodecompany.co/...`
//     en la URL bar, sin redirect ni prefix.
//
// **Async function (Feature B S3)**: la resolución del host pasó a depender
// de una query Neon iad1 (`app.lookup_place_by_domain` STABLE) para hosts
// candidatos a custom domain. El wrapper `resolveHostWithCustomDomains`
// (S2, host-routing.ts) acota el cost budget con política de skip estructural
// (apex, www, *.localhost, *.vercel.app → 0 queries). Hosts conocidos
// estructurales (subdomain canon, inbox, apex) mantienen el path 100% in-memory
// — la conversión a async NO impacta hot path del subdomain canónico.
//
// **Cross-subdomain cookie cerrado en Feature B S4a (ADR-0031, 2026-05-22)**:
// `src/i18n/routing.ts` ahora setea `localeCookie.domain = .<rootHost>`
// derivado de `NEXT_PUBLIC_APP_URL` vía el helper privado
// `localeCookieDomain()`. La preferencia de locale viaja apex↔subdomain canon
// (`place.community` ↔ `app.place.community` ↔ `{slug}.place.community`).
// Custom domains NO comparten cookie por design (origin distinto del root);
// allí el locale viene de `place.default_locale` resuelto en el layout (S3).

const intlMiddleware = createMiddleware(routing);

// ## CSP strict (nonce-based) — Phase 2.I
//
// Sólo en producción. `next dev` usa `eval` (React Refresh/HMR) + websockets
// del dev server: una CSP strict los bloquearía y rompería el dev — y la suite
// E2E (Playwright) corre sobre `next dev`. El header CSP estático (HSTS,
// X-Frame-Options, etc.) vive en `next.config.ts`; el CSP necesita nonce
// per-request → se compone acá. Smoke en prod: `pnpm build && pnpm start`.
//
// Mecánica del nonce: se genera por request y se SETEA en `req.headers`
// ANTES de cualquier branch. Razones:
//   - Next lee el nonce del header de request `Content-Security-Policy`
//     forwardeado al render y lo aplica a sus `<script>` de framework.
//   - El branch `marketing`/`inbox` delega en `intlMiddleware`, que internamente
//     copia `new Headers(req.headers)` para su forward → hereda nonce + CSP sin
//     intervención. En `inbox` el locale viaja en el PATH (`/inbox/[locale]/`),
//     no en un header, así que el rewrite manual puede forwardear `req.headers`
//     sin pisar el routing del locale.
//   - `x-nonce` queda disponible para `<Script nonce>` manuales (hoy ninguno).
//
// Devuelve el string CSP (para setearlo también en la respuesta) o `null` fuera
// de producción.
function prepareCsp(req: NextRequest): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy(nonce);
  req.headers.set(NONCE_HEADER, nonce);
  req.headers.set(CSP_HEADER, csp);
  return csp;
}

// Setea el header CSP en la respuesta (no-op fuera de producción).
function applyCsp(res: NextResponse, csp: string | null): NextResponse {
  if (csp) res.headers.set(CSP_HEADER, csp);
  return res;
}

// Rewrite que forwarda `req.headers` (con nonce + CSP) al render SÓLO cuando
// hay CSP activa; fuera de producción es un rewrite plano idéntico al previo
// (no agrega override-markers → comportamiento dev/test sin cambios).
function rewriteWithCsp(
  url: URL,
  req: NextRequest,
  csp: string | null,
): NextResponse {
  const res = csp
    ? NextResponse.rewrite(url, { request: { headers: req.headers } })
    : NextResponse.rewrite(url);
  return applyCsp(res, csp);
}

export default async function proxy(req: NextRequest): Promise<NextResponse> {
  const csp = prepareCsp(req);

  const target = await resolveHostWithCustomDomains(
    req.headers.get("host") ?? "",
    undefined,
    lookupPlaceByDomain,
  );

  if (target.zone === "marketing") return applyCsp(intlMiddleware(req), csp);

  if (target.zone === "inbox") {
    // 1. intl corre primero: resuelve locale, redirige (302) si falta el
    //    prefix, setea cookie NEXT_LOCALE si cambió.
    const intlResponse = intlMiddleware(req);

    // 2. Si intl redirigió (302), propagamos tal cual — la cookie va con el
    //    redirect; el siguiente request llega con el path ya prefixado y se
    //    procesa por el branch del rewrite.
    if (intlResponse.status >= 300 && intlResponse.status < 400) {
      return applyCsp(intlResponse, csp);
    }

    // 3. intl pasó (200/next). Aplicamos el rewrite al prefix interno
    //    `/inbox/`, propagando cookies (NEXT_LOCALE) y headers `x-*` que intl
    //    setea por compatibilidad server (`x-next-intl-locale` etc.). El
    //    `rewriteWithCsp` forwarda `req.headers` (con nonce + CSP) al render.
    const url = req.nextUrl.clone();
    const rest =
      url.pathname === "/" || url.pathname === "/inbox" ? "" : url.pathname;
    url.pathname = `/inbox${rest}`;
    const rewriteResponse = rewriteWithCsp(url, req, csp);
    intlResponse.cookies
      .getAll()
      .forEach((cookie) => rewriteResponse.cookies.set(cookie));
    intlResponse.headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith("x-")) {
        rewriteResponse.headers.set(key, value);
      }
    });
    return rewriteResponse;
  }

  if (target.zone === "custom-domain") {
    // Mismo rewrite que `place` pero NO se compone intl: el locale del chrome
    // se resuelve en el layout vía `place.default_locale` (cuando hay sesión
    // owner) o vía el `defaultLocale` que el propio lookup retornó (visitante
    // anónimo, gap auth V1 documentado en ADR-0031). La URL pública del
    // visitor permanece intacta (rewrite interno, no redirect).
    const url = req.nextUrl.clone();
    const rest = url.pathname === "/" ? "" : url.pathname;
    url.pathname = `/place/${target.slug}${rest}`;
    return rewriteWithCsp(url, req, csp);
  }

  // zone === "place"
  const url = req.nextUrl.clone();
  const rest = url.pathname === "/" ? "" : url.pathname;
  url.pathname = `/place/${target.slug}${rest}`;
  return rewriteWithCsp(url, req, csp);
}

export const config = {
  // Todo salvo API, estáticos de Next y archivos con extensión.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
