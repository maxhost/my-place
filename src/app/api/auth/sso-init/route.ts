import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { lookupPlaceByDomain } from "@/shared/lib/custom-domain-lookup";
import {
  STATE_COOKIE_MAX_AGE_SECONDS,
  STATE_COOKIE_NAME,
  generateNonce,
  generateState,
  signStateCookie,
  validateReturnTo,
} from "@/shared/lib/sso";

// Feature C · S8 · /api/auth/sso-init: entry point del silent SSO en custom
// domain. ADR-0032 §2 step 1 + §"Decisión 4 — State cookie".
//
// ## Rol en el flow
//
// El visitante con sesión apex pero sin sesión local del custom domain
// llega acá (lanzado por el layout `custom-domain-routing` cuando detecta
// `zone === 'custom-domain'` + sin cookie `__Host-place_sso_session`). El
// init:
//   1. Valida que el host actual sea custom domain VERIFIED (sin leak entre
//      not_found vs archived — ambos colapsan a 404).
//   2. Genera `state` (32 bytes base64url) y `nonce` (16 bytes base64url)
//      cryptographically random.
//   3. Firma `state.nonce` con HMAC SHA-256 (clave derivada via HKDF de la
//      signing key principal — sin env separada V1).
//   4. Setea cookie host-only `__Host-place_sso_state` (HttpOnly, Secure,
//      SameSite=Lax, Path=/, Max-Age=120s, sin Domain attribute — el
//      `__Host-` prefix obliga browser-side).
//   5. Redirige 302 al issuer apex con `state`/`nonce` echo'd en query.
//
// ## Status code: 302 explícito (no 307)
//
// Mismo contrato de S7: GET-to-GET redirect chain, sin re-POST. Forzar 302
// alinea con la industria (Circle, Discourse, Memberstack) y no depende
// del default cambiante de `NextResponse.redirect` entre versiones.
//
// ## Error paths
//
// - Host no verified → 404 con body texto plano `place_not_found`. NO leak
//   de detalle (not_found vs archived colapsan al mismo error — defensa
//   anti-enumeration contra `place_domain`).
// - `returnTo` malicioso → `validateReturnTo` lo sanitiza silently a `/`
//   (defensa #1 del triple-open-redirect-guard; el issue S7 valida #2, el
//   redeem #3 — ADR-0032 §3).
// - Sin sesión apex → NO se trata acá (el init es el primer hop, no requiere
//   sesión apex). El issue S7 detecta y redirige a login con flow preservado.
//
// ## Runtime
//
// - `runtime = 'nodejs'`: `signStateCookie` usa node `crypto` (HKDF/HMAC) +
//   WebCrypto via `loadSigningKey`. Edge soporta crypto pero la signing key
//   vive en env vars Node-only. Forzar nodejs evita auto-flip silencioso.
// - `dynamic = 'force-dynamic'`: el handler lee headers + emite redirect +
//   setea cookie cada call → Next NO debe intentar pre-renderizarlo. Mismo
//   patrón que `/api/auth/sso-issue` (S7).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  /** Path interno destino post-flow. Optional → default `/`. */
  returnTo: z.string().optional(),
});

/**
 * URL base del apex (`https://place.community` en prod o `http://localhost
 * :3000` en dev) derivada de `NEXT_PUBLIC_APP_URL`. Defense-in-depth:
 * fallback a `https://place.community` ante env ausente.
 *
 * Mismo helper que el de `sso-issue/route.ts` (S7) — duplicación consciente
 * para evitar acoplamiento entre handlers; cada uno encapsula su base URL.
 */
function apexBaseUrl(): string {
  try {
    const u = new URL(
      process.env.NEXT_PUBLIC_APP_URL ?? "https://place.community",
    );
    return `${u.protocol}//${u.host}`;
  } catch {
    return "https://place.community";
  }
}

/**
 * Construye la URL absoluta al issuer apex `${apexBaseUrl()}/api/auth/sso-
 * issue?aud=<host>&state=<>&nonce=<>&returnTo=<>` con TODOS los params
 * requeridos por el Zod schema strict del issuer (S7). El host destino lo
 * deriva del request actual (lookup ya validó verified), nunca del query.
 */
function buildIssueUrl(args: {
  aud: string;
  state: string;
  nonce: string;
  returnTo: string;
}): string {
  const u = new URL(`${apexBaseUrl()}/api/auth/sso-issue`);
  u.searchParams.set("aud", args.aud);
  u.searchParams.set("state", args.state);
  u.searchParams.set("nonce", args.nonce);
  u.searchParams.set("returnTo", args.returnTo);
  return u.toString();
}

/**
 * Setea cookie `__Host-place_sso_state` con shape canónica. El `__Host-`
 * prefix obliga browser-side: cookie DEBE tener `Path=/`, `Secure`, sin
 * `Domain` attribute. Si por bug se setea diferente, el browser rechaza
 * silently y el redeem (S8) falla loud (`?sso_error=state_invalid`) en vez
 * de degradar silently — defense-in-depth.
 *
 * NO se pasa `domain` (host-only enforced por el prefix). `httpOnly` +
 * `secure` cierran XSS leak + transport plain. `sameSite=lax` permite que
 * el cookie viaje en navegaciones top-level cross-site (init → issue → redeem)
 * pero bloquea cross-site fetches no-navegacionales.
 */
function setStateCookie(res: NextResponse, signedValue: string): void {
  res.cookies.set({
    name: STATE_COOKIE_NAME,
    value: signedValue,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
  });
}

/**
 * Host del request actual via `next/headers` (async desde Next 15). Strip
 * port + lowercase para alinear con la normalización que `lookupPlaceByDomain`
 * ya hace internamente — defense-in-depth.
 */
async function resolveCurrentHost(): Promise<string> {
  const h = await headers();
  const raw = h.get("host") ?? "";
  return raw.split(":")[0]?.trim().toLowerCase() ?? "";
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    returnTo: url.searchParams.get("returnTo") ?? undefined,
  });
  const returnTo = validateReturnTo(parsed.success ? parsed.data.returnTo : "/");

  const host = await resolveCurrentHost();
  const place = await lookupPlaceByDomain(host);
  if (!place) {
    return new Response("place_not_found", { status: 404 });
  }

  const state = generateState();
  const nonce = generateNonce();
  const signedCookie = await signStateCookie({ state, nonce });

  const res = NextResponse.redirect(
    buildIssueUrl({ aud: host, state, nonce, returnTo }),
    302,
  );
  setStateCookie(res, signedCookie);
  return res;
}
