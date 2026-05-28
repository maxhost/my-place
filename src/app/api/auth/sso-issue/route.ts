import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { buildApexLoginUrl } from "@/shared/lib/auth-redirect";
import { lookupPlaceByDomain } from "@/shared/lib/custom-domain-lookup";
import { verifyAccessToken } from "@/shared/lib/jwt";
import { enforceRateLimit, parseForwardedIp } from "@/shared/lib/rate-limit";
import { getSessionJwt } from "@/shared/lib/session";
import {
  buildTicketClaims,
  loadSigningKey,
  signSsoTicket,
  validateReturnTo,
} from "@/shared/lib/sso";

// Feature C · S7 · /api/auth/sso-issue: trusted issuer apex del Signed
// Ticket. ADR-0032 §2 step 2 + §"Decisión 5 — Issuer apex".
//
// ## Rol en el flow
//
// El custom domain (`/api/auth/sso-init`, S8) redirige acá con
// `?aud=<host>&state=<>&nonce=<>&returnTo=<>` tras generar state cookie
// host-only. El apex:
//   1. Valida `aud` está verified (`lookupPlaceByDomain` Feature B).
//   2. Valida sesión apex via `getSessionJwt` + `verifyAccessToken` —
//      mismo path que el resto del apex; el `sub` del JWT === `app.
//      current_user_id()` post-redeem → continuidad RLS.
//   3. Mintea ticket ES256 short-lived (60s) con `sub` extraído del JWT
//      Neon Auth + `aud` del custom domain + `jti` randomUUID + nonce/
//      state echo + iat/exp.
//   4. Redirige 302 al `redeem` del custom domain con ticket en query.
//
// **NO setea cookies en este handler**: las cookies del flow viven en
// custom domain (state cookie por init, session local por redeem). El
// apex solo emite tickets — sin estado persistente acá.
//
// ## Status code: 302 explícito (no 307)
//
// 302 + GET-to-GET es el contrato del Signed Ticket en industria (Circle,
// Discourse, Memberstack). El método sigue siendo GET — no hay preocupación
// por re-POST. `NextResponse.redirect(url, 302)` fuerza el status (default
// sería 307).
//
// ## Error paths (sin leak)
//
// - Zod fail → 400 (mensaje genérico, sin echo del input).
// - `aud` no verified → 400 (sin distinguir `not_found` vs `archived` —
//   evita enumeration attack contra `place_domain`).
// - Sin sesión apex → 302 a login con `returnTo` preservado al sso-issue
//   URL completo (tras login, el browser reintenta acá con la sesión).
// - JWT inválido → 401 (status genérico; el JWT está mal pero la sesión
//   "está", lo que indica config rota del cliente o token tamperado).
//
// ## Runtime
//
// - `runtime = 'nodejs'`: `verifyAccessToken` + `signSsoTicket` usan
//   WebCrypto. Edge soporta, pero la signing key vive en env Node-only.
//   Defensive: forzar nodejs evita auto-flip silencioso al edge.
// - `dynamic = 'force-dynamic'`: el handler lee headers/cookies + emite
//   redirect cada call → Next NO debe intentar pre-renderizarlo. Mismo
//   patrón que `/api/auth/sso-jwks` (S5).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  /** Host del custom domain destino (e.g. `nocodecompany.co`). Required. */
  aud: z.string().min(1),
  /** CSRF state generado por el init (echo'd en el ticket). Required. */
  state: z.string().min(1),
  /** CSRF nonce generado por el init (echo'd en el ticket). Required. */
  nonce: z.string().min(1),
  /** Path interno donde aterriza el redeem post-flow. Optional → default `/`. */
  returnTo: z.string().optional(),
});

type ParsedQuery = {
  aud: string;
  state: string;
  nonce: string;
  returnTo: string;
};

/**
 * URL base del apex (`https://place.community` en prod o
 * `http://localhost:3000` en dev) derivada de `NEXT_PUBLIC_APP_URL`.
 * Defense-in-depth: fallback a `https://place.community` ante env ausente.
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
 * Scheme para el redirect al custom domain (prod=https / dev=http según
 * el apex). Mismo principio que `apexScheme` en `auth-redirect.ts` (Feature
 * B): dev local con `*.localhost` corre http; prod custom domains, https.
 */
function customDomainScheme(): "http" | "https" {
  try {
    const u = new URL(
      process.env.NEXT_PUBLIC_APP_URL ?? "https://place.community",
    );
    return u.protocol === "http:" ? "http" : "https";
  } catch {
    return "https";
  }
}

/**
 * Zod parse + `validateReturnTo` (open-redirect guard #2 del flow — init
 * valida #1, redeem #3, triple defense per ADR-0032 §3). Null si la query
 * está incompleta (mapea a 400 en el handler).
 */
function parseQuery(url: URL): ParsedQuery | null {
  const parsed = querySchema.safeParse({
    aud: url.searchParams.get("aud") ?? undefined,
    state: url.searchParams.get("state") ?? undefined,
    nonce: url.searchParams.get("nonce") ?? undefined,
    returnTo: url.searchParams.get("returnTo") ?? undefined,
  });
  if (!parsed.success) return null;
  return {
    aud: parsed.data.aud,
    state: parsed.data.state,
    nonce: parsed.data.nonce,
    returnTo: validateReturnTo(parsed.data.returnTo),
  };
}

/**
 * Redirect a login apex con `returnTo` apuntando de vuelta al sso-issue URL
 * completo: tras login, el browser navega ahí y el handler ejecuta el happy
 * path con la sesión recién minted. Locale del login = `defaultLocale` del
 * place (resuelto vía `lookupPlaceByDomain` — el owner ve el chrome en su
 * idioma desde el primer paso del flow).
 */
function redirectToApexLogin(
  requestUrl: URL,
  defaultLocale: string,
): NextResponse {
  const continueUrl = `${apexBaseUrl()}${requestUrl.pathname}${requestUrl.search}`;
  const loginUrl = new URL(buildApexLoginUrl({ defaultLocale }));
  loginUrl.searchParams.set("returnTo", continueUrl);
  return NextResponse.redirect(loginUrl.toString(), 302);
}

/**
 * Mintea el ticket ES256 short-lived (60s) con claims canónicas. `nowSeconds`
 * + `jti` se inyectan acá (el builder es PURE — sin `Date.now()` ni
 * `randomUUID()` internamente, determinismo testeable). TTL canónica 60s
 * vía `buildTicketClaims` default; ADR-0032 §"Decisión 3".
 */
async function mintTicket(args: {
  sub: string;
  aud: string;
  state: string;
  nonce: string;
}): Promise<string> {
  const { privateKey, kid } = await loadSigningKey();
  const claims = buildTicketClaims({
    sub: args.sub,
    aud: args.aud,
    nonce: args.nonce,
    state: args.state,
    jti: randomUUID(),
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  return signSsoTicket({ claims, privateKey, kid });
}

/**
 * Construye la redeem URL absoluta `${scheme}://<aud>/api/auth/sso-redeem?...`.
 * El host viene de `aud` (ya validado verified en el handler — un returnTo
 * malicioso NO puede inyectar host externo). Defensa primaria contra
 * open-redirect: el browser navega SIEMPRE al custom domain verified.
 */
function buildRedeemUrl(args: {
  aud: string;
  ticket: string;
  state: string;
  returnTo: string;
}): string {
  const u = new URL(
    `${customDomainScheme()}://${args.aud}/api/auth/sso-redeem`,
  );
  u.searchParams.set("ticket", args.ticket);
  u.searchParams.set("state", args.state);
  u.searchParams.set("returnTo", args.returnTo);
  return u.toString();
}

export async function GET(req: Request): Promise<Response> {
  // Phase 0.D — rate limit por IP (10/min). Pre-zod para no consumir parse
  // en intentos bloqueados. 429 con `Retry-After` header (RFC 9110).
  const ip = parseForwardedIp(req.headers.get("x-forwarded-for"));
  const gate = await enforceRateLimit("sso_issue", ip);
  if (!gate.success) {
    const retryAfter = Math.max(
      1,
      Math.ceil((gate.resetAt - Date.now()) / 1000),
    );
    return new Response("rate_limited", {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    });
  }

  const url = new URL(req.url);
  const query = parseQuery(url);
  if (!query) {
    return new Response("invalid_query", { status: 400 });
  }
  const { aud, state, nonce, returnTo } = query;

  const place = await lookupPlaceByDomain(aud);
  if (!place) {
    return new Response("invalid_audience", { status: 400 });
  }

  const sessionJwt = await getSessionJwt();
  if (sessionJwt === null) {
    return redirectToApexLogin(url, place.defaultLocale);
  }

  let sub: string;
  try {
    const claims = await verifyAccessToken(sessionJwt);
    sub = claims.sub;
  } catch {
    return new Response("session_invalid", { status: 401 });
  }

  const ticket = await mintTicket({ sub, aud, state, nonce });
  return NextResponse.redirect(
    buildRedeemUrl({ aud, ticket, state, returnTo }),
    302,
  );
}
