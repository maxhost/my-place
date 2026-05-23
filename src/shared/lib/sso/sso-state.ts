import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

import { exportJWK } from "jose";

import { loadSigningKey } from "./sso-keys";

// Feature C · S3 · sso-state: cookie de CSRF state firmada con HMAC SHA-256
// (clave derivada via HKDF de la signing key ES256 — sin env separada V1) +
// open-redirect guard del `returnTo`. ADR-0032 §"Decisión 4 — State cookie
// + returnTo".
//
// ## Cómo encaja en el flow Signed Ticket
//
// El custom domain (`/api/auth/sso-init`, S8) genera `state` + `nonce` con
// `generateState/generateNonce`, los firma con `signStateCookie` y setea
// `__Host-place_sso_state` (host-only, Path=/, Secure, HttpOnly,
// SameSite=Lax, Max-Age=120s). Después redirige al apex con `state`+`nonce`
// en query. El apex devuelve el ticket con `state`+`nonce` echo'd, y el
// redeem (S8) re-lee la cookie + `verifyStateCookie` + compara state-query
// vs state-cookie (CSRF defense-in-depth). El nonce viaja DOS veces: una
// en la cookie, otra dentro del ticket → matchea en el redeem.
//
// ## Por qué HKDF en vez de env separada
//
// Reducir surface de env vars: una sola signing key (`PLACE_SSO_SIGNING_KEY`)
// del apex es la raíz de TODO el material criptográfico del flow. La HMAC
// key se deriva determinísticamente con HKDF(IKM=jwk.d, salt='place-sso-
// state-v1', info='hmac-sha256-cookie', keylen=32). Rotación del signing
// key rota automáticamente la HMAC key (downtime ≤60s = TTL del ticket).
//
// ## Invariantes (validados por unit tests)
//
// 1. **State / nonce no determinísticos.** `randomBytes` cryptographic
//    source — dos llamadas devuelven valores distintos. State = 32 bytes
//    (raw entropy), nonce = 16 bytes (CSRF echo only, no necesita entropía
//    máxima).
// 2. **HMAC en constant-time.** `verifyStateCookie` usa `timingSafeEqual`
//    para evitar timing oracle del signature comparison.
// 3. **Fail-soft, no throw.** `verifyStateCookie` retorna `null` para
//    CUALQUIER input inválido (malformado, signature mismatch, base64url
//    inválido). El handler S8 mapea `null → sso_error=state_invalid`. No
//    leakeamos el por qué falló al cliente.
// 4. **HMAC key derivada NUNCA en cookie / logs.** La cookie contiene
//    `state.nonce.signature_base64url` — el signature es output de HMAC,
//    no la clave. Regression test verifica que no aparezcan marcadores
//    del material privado.
// 5. **Open-redirect bloqueado en 3 puntos.** El `returnTo` se valida en
//    init (S8), issue (S7) y redeem (S8) — triple defense. `validateReturnTo`
//    es pura, sincrónica, idempotente: rechaza todo lo que no sea un path
//    absoluto-relativo same-origin (`/foo/bar?qs#hash`).
// 6. **`__Host-` prefix obliga shape.** El nombre del cookie comienza con
//    `__Host-` → browser RECHAZA el Set-Cookie si no es `Path=/ + Secure
//    + sin Domain attr`. Defense-in-depth automática enforced by browser.
//    Gotcha cubierto en `docs/gotchas/host-prefix-cookie-path.md`.

export const STATE_COOKIE_NAME = "__Host-place_sso_state" as const;
/** TTL = 60s ticket exp + 60s buffer para latencia de red en init→redeem. */
export const STATE_COOKIE_MAX_AGE_SECONDS = 120 as const;

// HKDF (RFC 5869) parameters. Strings versionados para forward-compat:
// si V2 necesita derivar más claves de la misma IKM, basta agregar otra
// constante `_v2` con un info distinto y un nuevo cache.
const HKDF_SALT = "place-sso-state-v1";
const HKDF_INFO = "hmac-sha256-cookie";
const HMAC_KEY_BYTES = 32; // SHA-256 block size — output ≥ key recommended.
const STATE_BYTES = 32; // 256 bits — exceeds CSRF entropy floor con margen.
const NONCE_BYTES = 16; // 128 bits — suficiente para echo no-replay (jti tiene la responsabilidad anti-replay real).

// Pre-validation regex: base64url alphabet (sin padding). `Buffer.from(...,
// 'base64url')` silenciosamente skip caracteres inválidos (no throws) — sin
// este pre-check, un atacante podría enviar un signature con relleno raro
// que decode al length correcto y pase timingSafeEqual.
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export interface StateCookieValue {
  state: string;
  nonce: string;
}

let cachedHmacKey: Promise<Buffer> | undefined;

async function deriveHmacKeyOnce(): Promise<Buffer> {
  const { privateKey } = await loadSigningKey();
  const jwk = await exportJWK(privateKey);
  if (typeof jwk.d !== "string" || jwk.d.length === 0) {
    // Defense-in-depth: la `d` component (private scalar) DEBE existir si
    // privateKey es EC private real. Si no → signing key inválida; fail-closed.
    throw new Error("sso-state: signing key missing private component");
  }
  const ikm = Buffer.from(jwk.d, "base64url");
  const okm = hkdfSync(
    "sha256",
    ikm,
    Buffer.from(HKDF_SALT, "utf8"),
    Buffer.from(HKDF_INFO, "utf8"),
    HMAC_KEY_BYTES,
  );
  // `hkdfSync` retorna ArrayBuffer; envolvemos en Buffer para createHmac.
  return Buffer.from(okm);
}

/**
 * Lazy singleton de la HMAC key derivada. Primera call deriva via HKDF
 * (~0.2ms cold), subsiguientes retornan cache. Si la derivación FALLA
 * (e.g. signing key missing `d`), cache invalida → reintento tras fix de env.
 */
async function getHmacKey(): Promise<Buffer> {
  if (!cachedHmacKey) {
    cachedHmacKey = deriveHmacKeyOnce().catch((err) => {
      cachedHmacKey = undefined;
      throw err;
    });
  }
  return cachedHmacKey;
}

/** Genera 32 bytes random base64url-encoded (~43 chars). CSRF state token. */
export function generateState(): string {
  return randomBytes(STATE_BYTES).toString("base64url");
}

/** Genera 16 bytes random base64url-encoded (~22 chars). CSRF nonce echo. */
export function generateNonce(): string {
  return randomBytes(NONCE_BYTES).toString("base64url");
}

/**
 * Firma `state.nonce` con HMAC SHA-256 y retorna el cookie value
 * `state.nonce.signature`. La signature es base64url (sin padding), de
 * length ~43 (32 bytes raw HMAC SHA-256 output).
 *
 * NO incluye expiry interno: el browser maneja Max-Age via el Set-Cookie
 * attribute (`STATE_COOKIE_MAX_AGE_SECONDS`). Aún si un atacante extrae
 * la cookie post-expiración, el `verifyStateCookie` en redeem la verá
 * ausente (browser ya la borró).
 */
export async function signStateCookie(value: StateCookieValue): Promise<string> {
  const key = await getHmacKey();
  const payload = `${value.state}.${value.nonce}`;
  const sig = createHmac("sha256", key).update(payload).digest("base64url");
  return `${value.state}.${value.nonce}.${sig}`;
}

/**
 * Verifica `state.nonce.signature` y retorna `{state, nonce}` si OK, `null`
 * si CUALQUIER paso falla (fail-soft, no throw, no leak del por qué).
 *
 * Pasos:
 *  1. Shape check: 3 segmentos no vacíos separados por `.`.
 *  2. Signature segment matchea base64url alphabet (pre-decode validation).
 *  3. HMAC re-computado vs signature provided en constant-time.
 *
 * El handler S8 redeem mapea `null → ?sso_error=state_invalid`.
 */
export async function verifyStateCookie(
  cookieValue: string,
): Promise<StateCookieValue | null> {
  if (typeof cookieValue !== "string" || cookieValue.length === 0) return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return null;
  const [state, nonce, sig] = parts;
  if (!state || !nonce || !sig) return null;
  // Pre-decode validation: Buffer.from('!!!', 'base64url') NO throws — silently
  // returns truncated/garbage bytes. Validar shape antes evita timing oracle.
  if (!BASE64URL_RE.test(sig)) return null;

  const key = await getHmacKey();
  const expected = createHmac("sha256", key).update(`${state}.${nonce}`).digest();
  const provided = Buffer.from(sig, "base64url");
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  return { state, nonce };
}

/**
 * Open-redirect guard del `returnTo`. Aplicado en 3 puntos del flow (init,
 * issue, redeem) — triple defense. Retorna SIEMPRE un string seguro (`/`
 * fallback), nunca lanza.
 *
 * Acepta sólo paths absoluto-relativos same-origin:
 *  - DEBE empezar con `/`.
 *  - NO `//` (protocol-relative).
 *  - NO `/\` (Windows-like protocol-relative en algunos parsers).
 *  - NO `://` en ningún lado (absolute URL embedded).
 *
 * Preserva query string + hash. NO normaliza `..` (Next.js routing lo
 * maneja; el riesgo de path traversal en server-side routing es bajo
 * porque el path se resuelve contra rutas estáticas, no filesystem).
 */
export function validateReturnTo(returnTo: string | null | undefined): string {
  if (typeof returnTo !== "string" || returnTo.length === 0) return "/";
  if (!returnTo.startsWith("/")) return "/";
  if (returnTo.startsWith("//") || returnTo.startsWith("/\\")) return "/";
  // Defense-in-depth: rechazar absolute URL embedded (`/redirect?to=https://...`
  // o variantes). Decisión consciente: bloquea algún caso legítimo edge
  // (`/search?q=protocol://foo`) en favor de no abrir ningún open-redirect.
  if (returnTo.includes("://")) return "/";
  return returnTo;
}

/**
 * Test-only: invalida el cache de HMAC key para que los tests puedan
 * re-derivar con nueva env stub. NO usar en runtime.
 */
export function __resetSsoStateCacheForTests(): void {
  cachedHmacKey = undefined;
}
