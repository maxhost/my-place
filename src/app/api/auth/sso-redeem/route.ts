import { timingSafeEqual } from "node:crypto";

import { type JWTVerifyGetKey, createRemoteJWKSet, customFetch } from "jose";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { lookupPlaceByDomain } from "@/shared/lib/custom-domain-lookup";
import {
  LOCAL_SESSION_COOKIE_NAME,
  LOCAL_SESSION_TTL_SECONDS,
  STATE_COOKIE_NAME,
  type SsoTicketClaims,
  SsoTicketError,
  consumeSsoJti,
  makeSafeRedirectFollowingFetch,
  mintLocalSession,
  validateReturnTo,
  verifySsoTicket,
  verifyStateCookie,
} from "@/shared/lib/sso";

// Feature C · S8 · sso-redeem: convergencia de TODA la validación de
// seguridad del Signed Ticket. ADR-0032 §2 step 3 + §"Decisión 1/4/5".
//
// Pipeline (9 checks → `RedeemError(code)` en cada fallo):
//   1. Zod parse query → invalid_query.
//   2. State cookie presente + signature válida → state_invalid (ausente y
//      tampered colapsan al mismo code: defense-in-depth anti enumeration).
//   3. State echo cookie (constant-time) → state_mismatch.
//   4. Ticket verify (jose `jwtVerify` audience+issuer enforced) → mapea
//      `SsoTicketError.code` o `signature_invalid` (JWKS fetch fail).
//   5. Nonce ticket === nonce cookie → nonce_mismatch.
//   6. Aud === host actual (re-check explícito) → aud_mismatch.
//   7. `consumeSsoJti` true → replay si false.
//   8. `lookupPlaceByDomain` post-verify (race archived_at) → invalid_audience.
//   9. `mintLocalSession` → catch → signature_invalid (signing key rota).
//
// UX: SIEMPRE redirect, NUNCA 4xx HTML. Error path → 302 a returnTo +
// `?sso_error=<code>`; el page settings (S10) ramifica por query. Cookies
// emitidas: happy = session local (7d) + state cleared; error = state cleared
// también (single-use defense). Status 302 explícito; `runtime='nodejs'` +
// `dynamic='force-dynamic'` por consistencia con sso-issue/sso-init.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  ticket: z.string().min(1),
  state: z.string().min(1),
  returnTo: z.string().optional(),
});

type ParsedQuery = { ticket: string; state: string; returnTo: string };

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

let cachedJwks: JWTVerifyGetKey | undefined;

/**
 * Lazy singleton del JWKS remoto del apex. `createRemoteJWKSet` cachea
 * internamente (jose ~10min TTL); este wrapper evita crear el getter
 * múltiples veces. Tests usan `__resetJwksCacheForTests` para swap fixtures.
 *
 * `customFetch` (Symbol export de jose v6) inyecta nuestro fetch wrapper que
 * sigue redirects same-registrable-domain. Sin esto, el redirect plataforma
 * Vercel apex→www (HTTP 307) tira el JWKS fetch — jose v6 hardcodea
 * `redirect: 'manual'` por defecto. Ver `docs/gotchas/jose-jwks-redirect-
 * manual.md` y ADR-0032 addendum §"Same-registrable-domain redirect policy".
 */
function getApexJwks(): JWTVerifyGetKey {
  if (!cachedJwks) {
    cachedJwks = createRemoteJWKSet(
      new URL(`${apexBaseUrl()}/api/auth/sso-jwks`),
      { [customFetch]: makeSafeRedirectFollowingFetch() },
    );
  }
  return cachedJwks;
}

export function __resetJwksCacheForTests(): void {
  cachedJwks = undefined;
}

/** Constant-time UTF-8 compare — anti timing oracle del state echo. */
function constantTimeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function parseQuery(url: URL): ParsedQuery | null {
  const parsed = querySchema.safeParse({
    ticket: url.searchParams.get("ticket") ?? undefined,
    state: url.searchParams.get("state") ?? undefined,
    returnTo: url.searchParams.get("returnTo") ?? undefined,
  });
  if (!parsed.success) return null;
  return {
    ticket: parsed.data.ticket,
    state: parsed.data.state,
    returnTo: validateReturnTo(parsed.data.returnTo),
  };
}

async function resolveCurrentHost(): Promise<string> {
  const h = await headers();
  const raw = h.get("host") ?? "";
  return raw.split(":")[0]?.trim().toLowerCase() ?? "";
}

function buildLandingUrl(args: {
  host: string;
  returnTo: string;
  ssoError?: string;
}): string {
  const u = new URL(`${customDomainScheme()}://${args.host}${args.returnTo}`);
  if (args.ssoError) u.searchParams.set("sso_error", args.ssoError);
  return u.toString();
}

function setSessionCookie(res: NextResponse, jwt: string): void {
  res.cookies.set({
    name: LOCAL_SESSION_COOKIE_NAME,
    value: jwt,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: LOCAL_SESSION_TTL_SECONDS,
  });
}

/** Borra state cookie (Max-Age=0) — single-use, también en error path. */
function deleteStateCookie(res: NextResponse): void {
  res.cookies.set({
    name: STATE_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** 302 a returnTo + `?sso_error=<code>` + state cookie cleared (NUNCA session). */
function errorRedirect(args: {
  host: string;
  returnTo: string;
  code: string;
}): NextResponse {
  const res = NextResponse.redirect(
    buildLandingUrl({
      host: args.host,
      returnTo: args.returnTo,
      ssoError: args.code,
    }),
    302,
  );
  deleteStateCookie(res);
  return res;
}

class RedeemError extends Error {
  constructor(public readonly code: string) {
    super(`SSO redeem error: ${code}`);
    this.name = "RedeemError";
  }
}

/**
 * Verify ticket vs JWKS apex con tracking del JWKS fetch — distinguir "JWKS
 * fetch falló" del fallback `missing_claim` conservador de `mapJoseError`.
 * Semánticamente un fetch fail es `signature_invalid` (no pudimos establecer
 * trust con el apex). Throws `RedeemError` con `code` mapeado.
 */
async function verifyTicketAgainstApex(
  token: string,
  host: string,
): Promise<SsoTicketClaims> {
  let jwksFailed = false;
  const trackingJwks: JWTVerifyGetKey = async (header, t) => {
    try {
      return await getApexJwks()(header, t);
    } catch (err) {
      jwksFailed = true;
      throw err;
    }
  };
  try {
    return await verifySsoTicket({
      token,
      expectedAud: host,
      keys: trackingJwks,
    });
  } catch (err) {
    if (jwksFailed) throw new RedeemError("signature_invalid");
    throw new RedeemError(
      err instanceof SsoTicketError ? err.code : "signature_invalid",
    );
  }
}

/**
 * Pipeline de validación + consume + mint. Throws `RedeemError` con `code`
 * específico en cada path de fallo; happy retorna JWT local listo para cookie.
 */
async function consumeAndMintSession(args: {
  query: ParsedQuery;
  host: string;
  cookieJar: Awaited<ReturnType<typeof cookies>>;
}): Promise<string> {
  const { query, host, cookieJar } = args;

  const stateValue = cookieJar.get(STATE_COOKIE_NAME)?.value;
  if (!stateValue) throw new RedeemError("state_invalid");
  const stateCookie = await verifyStateCookie(stateValue);
  if (!stateCookie) throw new RedeemError("state_invalid");
  if (!constantTimeEqualStr(stateCookie.state, query.state)) {
    throw new RedeemError("state_mismatch");
  }

  const claims = await verifyTicketAgainstApex(query.ticket, host);

  if (claims.nonce !== stateCookie.nonce) {
    throw new RedeemError("nonce_mismatch");
  }
  if (claims.aud !== host) throw new RedeemError("aud_mismatch");

  const consumed = await consumeSsoJti(
    claims.jti,
    new Date(claims.exp * 1000),
  );
  if (!consumed) throw new RedeemError("replay");

  const place = await lookupPlaceByDomain(host);
  if (!place) throw new RedeemError("invalid_audience");

  try {
    return await mintLocalSession({
      sub: claims.sub,
      host,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
  } catch {
    throw new RedeemError("signature_invalid");
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const host = await resolveCurrentHost();
  // Extraer returnTo independiente del Zod parse: aún si el resto del query
  // falla, el error redirect aterriza en el path original con
  // `?sso_error=invalid_query`. UX coherente.
  const returnTo = validateReturnTo(url.searchParams.get("returnTo"));

  const query = parseQuery(url);
  if (!query) {
    return errorRedirect({ host, returnTo, code: "invalid_query" });
  }

  let sessionJwt: string;
  try {
    sessionJwt = await consumeAndMintSession({
      query,
      host,
      cookieJar: await cookies(),
    });
  } catch (err) {
    const code = err instanceof RedeemError ? err.code : "signature_invalid";
    return errorRedirect({ host, returnTo, code });
  }

  const res = NextResponse.redirect(
    buildLandingUrl({ host, returnTo }),
    302,
  );
  setSessionCookie(res, sessionJwt);
  deleteStateCookie(res);
  return res;
}
