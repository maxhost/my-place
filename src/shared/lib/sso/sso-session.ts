import { SignJWT, errors as joseErrors, jwtVerify } from "jose";

import { SSO_TICKET_ALG, loadSigningKey } from "./sso-keys";

// Feature C · S4 · sso-session: local session JWT del custom domain (cookie
// `__Host-place_sso_session`). ADR-0032 §"Decisión 5 — Local session cookie".
//
// ## Cómo encaja en el flow Signed Ticket
//
// Post-redeem (S8): el custom domain mintea un JWT ES256 local — firmado con
// la MISMA signing key del apex (single-key V1) — y lo persiste en una
// cookie host-only. Próximas requests al custom domain leen la cookie,
// `verifyLocalSession` valida firma+host+exp, y el bridge S4
// `db-with-verifier.ts` inyecta el `sub` resultante como
// `request.jwt.claims.sub` tx-local → RLS funciona idéntico a apex (mismo
// `sub` = `neon_auth.user.id` = `app.current_user_id()`).
//
// ## Por qué reusar la signing key del apex (no una key separada)
//
// 1. **Surface de env reducida.** Una sola env crítica (`PLACE_SSO_SIGNING_KEY`)
//    es la raíz de TODO el material criptográfico del flow (ticket + state
//    cookie HMAC vía HKDF + local session JWT). Rotación coherente.
// 2. **Trust topology clara.** El apex ES la raíz de trust del Signed Ticket
//    pattern. La cookie de sesión local hereda esa confianza: si el apex
//    no puede emitir, el custom domain tampoco puede sostener sesión.
// 3. **Verify side simétrica.** El custom domain ya tiene que poder
//    verificar tickets del apex (via JWKS público) — la pública del local
//    session JWT es la misma. `verifyLocalSession` usa `loadSigningKey()`
//    directo en V1 single-key; V2 multi-key resolvería via JWKS.
//
// ## Por qué `host` claim (no `aud` standard)
//
// El ticket usa `aud` para audience binding (host del custom domain target).
// La sesión local podría usar `aud` también, pero deliberadamente usamos
// claim custom `host` para visualmente separar los dos JWTs en logs/debug:
// si ves `aud=`, es un ticket en vuelo; si ves `host=`, es una sesión
// establecida. El check de host es defense-in-depth contra cookie robada
// y re-presentada en otro custom domain (browser garantiza host-only via
// `__Host-` prefix, pero el claim chequea explícito).
//
// ## Invariantes (validados por unit tests)
//
// 1. **Issuer locked.** `iss = LOCAL_SESSION_ISSUER` ('place.community').
//    `verifyLocalSession` rechaza cualquier otro emisor.
// 2. **Alg whitelisted.** `algorithms: ['ES256']` — anti-downgrade.
// 3. **Host match estricto.** `payload.host === expectedHost` post-verify.
//    Mismatch → `LocalSessionError("host_mismatch")`.
// 4. **TTL 7d.** Trade-off UX (no re-loguear cada día) vs blast radius
//    (cookie robada vale 7d hasta natural rotation via re-SSO).
// 5. **Errores discriminados.** `LocalSessionError.code` mapea cada path
//    de fallo. El handler S8/S9 puede mapear cada code a un fallback UI
//    sin parsear mensajes.

export const LOCAL_SESSION_COOKIE_NAME = "__Host-place_sso_session" as const;
export const LOCAL_SESSION_ISSUER = "place.community" as const;
/** 7 días = 604800s. Trade-off UX vs blast radius documentado arriba. */
export const LOCAL_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Claims canónicos de la sesión local del custom domain. Todos required;
 * `verifyLocalSession` rechaza si falta alguno.
 *
 * - `iss`: siempre `LOCAL_SESSION_ISSUER` (apex es raíz de trust).
 * - `sub`: `neon_auth.user.id` — same value que `app.current_user_id()`
 *   en RLS. Continuidad cero-refactor con apex.
 * - `host`: host del custom domain (e.g. `nocodecompany.co`). Defense-in-
 *   depth contra cookie robada y re-presentada en otro host.
 * - `iat` / `exp`: epoch seconds. `exp - iat === LOCAL_SESSION_TTL_SECONDS`
 *   por default; el caller puede pasar `ttlSeconds` para tests.
 */
export interface LocalSessionClaims {
  iss: string;
  sub: string;
  host: string;
  iat: number;
  exp: number;
}

/**
 * Error específico (no `Error` genérico) con `code` discriminado — paralelo
 * a `SsoTicketError`. El consumer (S9 `getSessionTokenForZone`) mapea
 * códigos a `null` (re-trigger silent SSO) o a errores explícitos sin
 * leakear stack interno.
 */
export class LocalSessionError extends Error {
  constructor(
    public readonly code:
      | "expired"
      | "host_mismatch"
      | "iss_mismatch"
      | "signature_invalid"
      | "missing_claim"
      | "jwt_malformed",
  ) {
    super(`SSO local session error: ${code}`);
    this.name = "LocalSessionError";
  }
}

export interface MintLocalSessionOptions {
  sub: string;
  host: string;
  /** Epoch seconds — inyectable para determinismo en tests + control S8. */
  nowSeconds: number;
  /** Default `LOCAL_SESSION_TTL_SECONDS` (7d). El caller raramente lo cambia. */
  ttlSeconds?: number;
}

/**
 * Firma un compact-JWS ES256 con la signing key del apex (single-key V1).
 * Protected header incluye `alg` + `kid` — forward-compat con V2 multi-key.
 * El claim `host` viaja en el payload custom; los standard (iss/sub/iat/exp)
 * los setea jose vía setters.
 */
export async function mintLocalSession(
  opts: MintLocalSessionOptions,
): Promise<string> {
  const { privateKey, kid } = await loadSigningKey();
  const ttl = opts.ttlSeconds ?? LOCAL_SESSION_TTL_SECONDS;
  return new SignJWT({ host: opts.host })
    .setProtectedHeader({ alg: SSO_TICKET_ALG, kid })
    .setIssuer(LOCAL_SESSION_ISSUER)
    .setSubject(opts.sub)
    .setIssuedAt(opts.nowSeconds)
    .setExpirationTime(opts.nowSeconds + ttl)
    .sign(privateKey);
}

export interface VerifyLocalSessionOptions {
  token: string;
  /** Host actual del request (e.g. `nocodecompany.co` del header `Host`). */
  expectedHost: string;
}

/**
 * Verifica firma + claims canónicos + host match. Mapea cada error de jose
 * a un `LocalSessionError.code` discriminado. Happy path retorna
 * `LocalSessionClaims` tipado.
 *
 * Orden de checks:
 *  1. jose internal: parse → signature → iss → exp.
 *  2. Manual: sub/host/iat/exp/iss son tipos correctos no-vacíos.
 *  3. Manual: host claim === expectedHost (defense-in-depth).
 */
export async function verifyLocalSession(
  opts: VerifyLocalSessionOptions,
): Promise<LocalSessionClaims> {
  const { publicKey } = await loadSigningKey();
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(opts.token, publicKey, {
      issuer: LOCAL_SESSION_ISSUER,
      algorithms: [SSO_TICKET_ALG],
    });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    throw mapJoseError(err);
  }

  // Custom claim `host` + validación defensiva de standard claims. jose
  // verificó iss/exp por nosotros; el resto lo cubrimos manual para no
  // depender del shape interno de jose.
  const sub = payload.sub;
  const host = payload.host;
  const iat = payload.iat;
  const exp = payload.exp;
  const iss = payload.iss;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new LocalSessionError("missing_claim");
  }
  if (typeof host !== "string" || host.length === 0) {
    throw new LocalSessionError("missing_claim");
  }
  if (typeof iat !== "number" || typeof exp !== "number") {
    throw new LocalSessionError("missing_claim");
  }
  if (typeof iss !== "string") {
    throw new LocalSessionError("missing_claim");
  }
  if (host !== opts.expectedHost) {
    throw new LocalSessionError("host_mismatch");
  }

  return { iss, sub, host, iat, exp };
}

/**
 * Mapeo de errores jose → `LocalSessionError`. Mismo pattern que
 * `sso-ticket.ts mapJoseError`. Fallback conservador = `missing_claim`
 * (no exponemos shape interno del error original).
 */
function mapJoseError(err: unknown): LocalSessionError {
  if (err instanceof joseErrors.JWTExpired) {
    return new LocalSessionError("expired");
  }
  if (err instanceof joseErrors.JWTClaimValidationFailed) {
    if (err.claim === "iss") return new LocalSessionError("iss_mismatch");
    return new LocalSessionError("missing_claim");
  }
  if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
    return new LocalSessionError("signature_invalid");
  }
  if (
    err instanceof joseErrors.JWSInvalid ||
    err instanceof joseErrors.JWTInvalid
  ) {
    return new LocalSessionError("jwt_malformed");
  }
  return new LocalSessionError("missing_claim");
}
