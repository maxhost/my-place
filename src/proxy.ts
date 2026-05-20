import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { resolveHost } from "@/shared/lib/host-routing";

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
//
// **TODO empíricamente verificado, S5a:** next-intl 4.12.0 soporta
// `localeCookie: { domain: ".place.community" }` en `defineRouting()` (API
// estable, mergea sobre defaults `name=NEXT_LOCALE` + `sameSite=lax`). Hoy
// `src/i18n/routing.ts` NO lo setea: la cookie queda host-only y la
// preferencia de locale NO persiste cross-subdomain (apex→app). En V1 sólo
// `es` está poblado (spec §i18n) → UX degradada pero NO bloqueante. Si el
// smoke prod de S5c confirma que el problema importa, agregar:
//   `localeCookie: { name: "NEXT_LOCALE", sameSite: "lax", domain: ".place.community", path: "/", secure: true }`
// en `routing.ts`. Mini-commit independiente; el cambio no toca este archivo.

const intlMiddleware = createMiddleware(routing);

export default function proxy(req: NextRequest): NextResponse {
  const target = resolveHost(req.headers.get("host") ?? "");

  if (target.zone === "marketing") return intlMiddleware(req);

  if (target.zone === "inbox") {
    // 1. intl corre primero: resuelve locale, redirige (302) si falta el
    //    prefix, setea cookie NEXT_LOCALE si cambió.
    const intlResponse = intlMiddleware(req);

    // 2. Si intl redirigió (302), propagamos tal cual — la cookie va con el
    //    redirect; el siguiente request llega con el path ya prefixado y se
    //    procesa por el branch del rewrite.
    if (intlResponse.status >= 300 && intlResponse.status < 400) {
      return intlResponse;
    }

    // 3. intl pasó (200/next). Aplicamos el rewrite al prefix interno
    //    `/inbox/`, propagando cookies (NEXT_LOCALE) y headers `x-*` que intl
    //    setea por compatibilidad server (`x-next-intl-locale` etc.).
    const url = req.nextUrl.clone();
    const rest =
      url.pathname === "/" || url.pathname === "/inbox" ? "" : url.pathname;
    url.pathname = `/inbox${rest}`;
    const rewriteResponse = NextResponse.rewrite(url);
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

  // zone === "place"
  const url = req.nextUrl.clone();
  const rest = url.pathname === "/" ? "" : url.pathname;
  url.pathname = `/place/${target.slug}${rest}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Todo salvo API, estáticos de Next y archivos con extensión.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
