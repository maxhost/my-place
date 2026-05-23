import { SignJWT, errors as joseErrors, jwtVerify } from "jose";

import { SSO_TICKET_ALG } from "./sso-keys";

// Feature C · S2 · sso-ticket: mint + verify del JWT ES256 corto que
// conecta los dos mundos (apex `place.community` ↔ custom domains
// verified). ADR-0032 §"Decisión 1 — Modelo Signed Ticket" + §"Decisión 3
// — Ticket claims".
//
// Pattern paralelo a `shared/lib/jwt.ts` (verificación del access token
// Neon Auth contra JWKS remoto) con una diferencia clave: acá **Place ES
// el firmante**, no el verificador del IdP externo. Mintea con la signing
// key de `sso-keys.loadSigningKey()` (apex env-only, nunca leakeada);
// verifica contra el JWKS público (`/api/auth/sso-jwks` en S5 o local set
// en tests).
//
// ## Invariantes (validados por unit tests)
//
// 1. **Issuer locked.** `iss` siempre es `SSO_TICKET_ISSUER`. El verify
//    rechaza cualquier otro emisor (defensa anti-impersonation: si un
//    atacante obtiene la public key y firma con otra apex falsa, el
//    canonical issuer corta el ataque). `buildTicketClaims` hardcodea
//    `iss` — el caller no puede pasar otro.
// 2. **Alg whitelisted.** `verifySsoTicket` pasa `algorithms: ['ES256']` a
//    jose: ataques tipo `alg=none` o downgrade a HMAC quedan fuera.
// 3. **Missing-claim guard explícito.** Post-`jwtVerify`, validamos que
//    `nonce`, `state`, `jti` son strings no vacíos. jose verifica
//    `iss/aud/exp/iat` natively; los custom claims que NO son standard
//    JWT necesitan validación manual.
// 4. **Pure `buildTicketClaims`.** Sin `Date.now()`, sin `randomUUID()`.
//    El caller inyecta `nowSeconds` + `jti`. Determinismo absoluto en
//    tests + el side effect de tiempo/random vive en el handler (S7
//    `/api/auth/sso-issue`).
// 5. **TTL canónica 60s** (ADR-0032). Rotation manual cada 90d acepta
//    downtime ≤60s — tickets en vuelo durante el cutover fallarán
//    `signature_invalid` y el owner ve `<SsoFallbackPanel>` con retry.
// 6. **Errores discriminados, no genéricos.** `SsoTicketError.code`
//    distingue los 6 paths de fallo. El handler S8 mapea cada code a un
//    `?sso_error=<code>` en la query del redirect — telemetría rica sin
//    leakear info de implementación al cliente.

export const SSO_TICKET_ISSUER = "place.community" as const;
export const SSO_TICKET_TTL_SECONDS = 60 as const;

/**
 * Claims canónicos del Signed Ticket (ADR-0032 §"Decisión 3"). Todos
 * required — `verifySsoTicket` rechaza si falta alguno.
 *
 * - `iss`: siempre `SSO_TICKET_ISSUER` (`place.community`).
 * - `sub`: `neon_auth.user.id` — same value que `app.current_user_id()`
 *   en RLS, mantiene continuidad post-redeem.
 * - `aud`: host del custom domain (e.g. `nocodecompany.co`). El redeem
 *   re-valida `aud === host actual` (defense-in-depth contra ticket
 *   robado y replayed en otro dominio).
 * - `nonce`: CSRF echo — el redeem matchea contra el nonce del state
 *   cookie host-only (`__Host-place_sso_state`).
 * - `state`: CSRF state — same purpose que nonce, doble layer per ADR.
 * - `jti`: single-use replay key. El redeem consume vía
 *   `app.consume_sso_jti` (S8); segundo intento del mismo jti → false →
 *   `sso_error=replay`.
 * - `iat` / `exp`: epoch seconds. `exp - iat === SSO_TICKET_TTL_SECONDS`.
 */
export interface SsoTicketClaims {
  iss: string;
  sub: string;
  aud: string;
  nonce: string;
  state: string;
  jti: string;
  iat: number;
  exp: number;
}

/**
 * Error específico (no `Error` genérico) con `code` discriminado —
 * paralelo a `SsoKeyConfigError`. El handler S8 mapea cada code a un
 * `?sso_error=<code>` query del redirect, sin leakear stack ni payload.
 */
export class SsoTicketError extends Error {
  constructor(
    public readonly code:
      | "expired"
      | "aud_mismatch"
      | "iss_mismatch"
      | "signature_invalid"
      | "missing_claim"
      | "jwt_malformed",
  ) {
    super(`SSO ticket error: ${code}`);
    this.name = "SsoTicketError";
  }
}

export interface BuildTicketClaimsOptions {
  sub: string;
  aud: string;
  nonce: string;
  state: string;
  jti: string;
  /** Epoch seconds — inyectable para determinismo en tests + S7 control. */
  nowSeconds: number;
  /** Default `SSO_TICKET_TTL_SECONDS` (60). El caller raramente lo cambia. */
  ttlSeconds?: number;
}

/**
 * Función PURA: mismos inputs → mismo output. Sin `Date.now()`, sin
 * `randomUUID()`. El caller (S7 handler) inyecta `nowSeconds` (=
 * `Math.floor(Date.now()/1000)`) y `jti` (= `crypto.randomUUID()`). Esa
 * inyección hace al ticket builder trivialmente testeable y al handler
 * el único punto donde el tiempo/random vive.
 */
export function buildTicketClaims(
  opts: BuildTicketClaimsOptions,
): SsoTicketClaims {
  const ttl = opts.ttlSeconds ?? SSO_TICKET_TTL_SECONDS;
  return {
    iss: SSO_TICKET_ISSUER,
    sub: opts.sub,
    aud: opts.aud,
    nonce: opts.nonce,
    state: opts.state,
    jti: opts.jti,
    iat: opts.nowSeconds,
    exp: opts.nowSeconds + ttl,
  };
}

export interface SignSsoTicketOptions {
  claims: SsoTicketClaims;
  /** Private key cargada por `loadSigningKey()` (sso-keys.ts). */
  privateKey: CryptoKey;
  /** Mismo `kid` que el JWKS público — el redeem lo matchea via JWS header. */
  kid: string;
}

/**
 * Firma un ticket compact-JWS ES256. Setea claims standard via setters de
 * `SignJWT` + custom claims (`nonce`, `state`) via constructor payload.
 * Protected header incluye `alg: 'ES256'` + `kid` — forward-compat con V2
 * multi-key rotation (el verifier matchea por kid contra el JWKS).
 */
export async function signSsoTicket(
  opts: SignSsoTicketOptions,
): Promise<string> {
  return new SignJWT({
    nonce: opts.claims.nonce,
    state: opts.claims.state,
  })
    .setProtectedHeader({ alg: SSO_TICKET_ALG, kid: opts.kid })
    .setIssuer(opts.claims.iss)
    .setSubject(opts.claims.sub)
    .setAudience(opts.claims.aud)
    .setIssuedAt(opts.claims.iat)
    .setExpirationTime(opts.claims.exp)
    .setJti(opts.claims.jti)
    .sign(opts.privateKey);
}

export interface VerifySsoTicketOptions {
  token: string;
  /** Host del custom domain actual (e.g. `nocodecompany.co`). */
  expectedAud: string;
  /**
   * jose-compatible key source: `createLocalJWKSet(...)` (tests),
   * `createRemoteJWKSet(new URL(...))` (S8 redeem) o un `CryptoKey`
   * directo (happy path interno V1 single-key).
   */
  keys: Parameters<typeof jwtVerify>[1];
}

/**
 * Verifica firma + claims canónicos del ticket. Mapea cada error de jose
 * a un `SsoTicketError.code` discriminado. El happy path retorna el
 * payload tipado como `SsoTicketClaims` (tras validar custom claims).
 *
 * Orden de checks (jose internally):
 *   1. JWS structural parse → `JWSInvalid` / `JWTInvalid`.
 *   2. Signature verify contra `keys` → `JWSSignatureVerificationFailed`.
 *   3. Claims standard (`iss/aud/exp`) → `JWTClaimValidationFailed` o
 *      `JWTExpired`.
 *   4. (manual) Custom claims `nonce/state/jti` no vacíos → `missing_claim`.
 */
export async function verifySsoTicket(
  opts: VerifySsoTicketOptions,
): Promise<SsoTicketClaims> {
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(opts.token, opts.keys, {
      issuer: SSO_TICKET_ISSUER,
      audience: opts.expectedAud,
      algorithms: [SSO_TICKET_ALG],
    });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    throw mapJoseError(err);
  }

  // Custom claims: jose ya verificó iss/aud/exp/iat por nosotros. Pero
  // `nonce`, `state`, `jti` son extensiones del Signed Ticket — jose las
  // ignora. Validamos manualmente que sean strings no vacíos; si falta
  // alguna → `missing_claim` (mismo code paraguas: el handler no necesita
  // saber CUÁL faltó, sólo que el ticket es inválido).
  const nonce = payload.nonce;
  const state = payload.state;
  const jti = payload.jti;
  if (typeof nonce !== "string" || nonce.length === 0) {
    throw new SsoTicketError("missing_claim");
  }
  if (typeof state !== "string" || state.length === 0) {
    throw new SsoTicketError("missing_claim");
  }
  if (typeof jti !== "string" || jti.length === 0) {
    throw new SsoTicketError("missing_claim");
  }

  // El cast es seguro: jose verificó iss/aud/exp y nosotros nonce/state/jti.
  // sub/iat los garantiza jose vía las opciones (iat siempre presente tras
  // verify exitoso; sub es estándar — validamos defensive abajo).
  const sub = payload.sub;
  const iat = payload.iat;
  const exp = payload.exp;
  const iss = payload.iss;
  const aud = payload.aud;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new SsoTicketError("missing_claim");
  }
  if (typeof iat !== "number" || typeof exp !== "number") {
    throw new SsoTicketError("missing_claim");
  }
  if (typeof iss !== "string" || typeof aud !== "string") {
    throw new SsoTicketError("missing_claim");
  }

  return { iss, sub, aud, nonce, state, jti, iat, exp };
}

/**
 * Mapeo de errores jose → `SsoTicketError` discriminado. Cada path está
 * cubierto por un test. Anything no esperado cae a `missing_claim` (label
 * conservadora: no leakeamos el shape del error original al handler).
 */
function mapJoseError(err: unknown): SsoTicketError {
  // `JWTExpired extends JOSEError implements JWTClaimValidationFailed` —
  // chequeamos PRIMERO para no caer en la rama de claim validation.
  if (err instanceof joseErrors.JWTExpired) {
    return new SsoTicketError("expired");
  }
  if (err instanceof joseErrors.JWTClaimValidationFailed) {
    // jose setea `claim` al claim que falló: 'aud' o 'iss' acá. Otros
    // claims (sub/iat/jti) no los validamos via opts de jwtVerify, así
    // que en V1 sólo vemos aud/iss en esta rama.
    if (err.claim === "aud") return new SsoTicketError("aud_mismatch");
    if (err.claim === "iss") return new SsoTicketError("iss_mismatch");
    return new SsoTicketError("missing_claim");
  }
  if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
    return new SsoTicketError("signature_invalid");
  }
  if (
    err instanceof joseErrors.JWSInvalid ||
    err instanceof joseErrors.JWTInvalid
  ) {
    return new SsoTicketError("jwt_malformed");
  }
  // Fallback conservador: cualquier otro `JOSEError` (JWKSNoMatchingKey,
  // JOSEAlgNotAllowed, etc.) o error genérico se reporta como
  // `missing_claim` — no exponemos el shape interno al handler.
  return new SsoTicketError("missing_claim");
}
