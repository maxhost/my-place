import {
  type JSONWebKeySet,
  exportJWK,
  importJWK,
  importPKCS8,
} from "jose";

// Feature C · S2 · sso-keys: carga del Signed Ticket signing key
// (ADR-0032 §"Decisión 2 — single-key V1 + KID forward-compat").
//
// `PLACE_SSO_SIGNING_KEY` (PKCS8 PEM ES256, único contenido en env Vercel,
// nunca `.env.local` committed) firma los tickets que el apex emite y el
// custom domain redime. La pública se deriva en runtime — no hay env
// separada — y se expone via `/api/auth/sso-jwks` (S5).
//
// ## Invariantes (validados por unit tests + gotchas)
//
// 1. **Key NUNCA loggeada.** `SsoKeyConfigError` carga sólo el `code`, no
//    el contenido del PEM ni mensajes derivados de `importPKCS8` (que
//    pueden incluir el PEM en stack traces). Regression de
//    `docs/gotchas/sso-signing-key-no-log.md`.
// 2. **Lazy singleton.** `loadSigningKey` parsea el PEM una sola vez por
//    proceso (cold-start cost amortizado). Si el parse FALLA, el cache se
//    invalida → permite reintento tras corrección de env (e.g. tras
//    rotación en Vercel sin redeploy completo).
// 3. **Pública derivada de la privada.** No hay env separada para la
//    pública. `exportJWK(privateKey)` retorna JWK con todos los
//    componentes EC (`kty`, `crv`, `x`, `y`, `d`); el JWKS público sólo
//    incluye `kty/crv/x/y` (defensa contra leak de `d`).
// 4. **Single-key V1.** Sólo una key + un kid. La rotación es manual cada
//    90 días (procedimiento en ADR-0032 §"Operational rotation"). V2
//    multi-key zero-downtime queda diferida (env array).
//
// Pattern paralelo a `shared/lib/jwt.ts` (verificación del access token
// Neon Auth contra JWKS remoto) pero invertido: acá Place ES el firmante,
// no el verificador del IdP externo.

export const SSO_TICKET_ALG = "ES256" as const;
export const SSO_TICKET_USE = "sig" as const;

/**
 * Error específico (no `Error` genérico) para fail-closed handling del
 * env de signing key. El consumer (sso-jwks endpoint, sso-issue handler)
 * puede distinguir códigos sin parsear mensajes.
 *
 * El mensaje JAMÁS incluye el contenido del PEM (regression test cubre).
 */
export class SsoKeyConfigError extends Error {
  constructor(
    public readonly code:
      | "env_missing_key"
      | "env_missing_kid"
      | "key_parse_failed",
  ) {
    super(`SSO signing key config error: ${code}`);
    this.name = "SsoKeyConfigError";
  }
}

export interface LoadedSigningKey {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  kid: string;
}

let cached: Promise<LoadedSigningKey> | undefined;

async function loadKeyOnce(): Promise<LoadedSigningKey> {
  const pem = process.env.PLACE_SSO_SIGNING_KEY;
  const kid = process.env.PLACE_SSO_SIGNING_KEY_KID;
  if (!pem) throw new SsoKeyConfigError("env_missing_key");
  if (!kid) throw new SsoKeyConfigError("env_missing_kid");

  let privateKey: CryptoKey;
  try {
    privateKey = (await importPKCS8(pem, SSO_TICKET_ALG, {
      extractable: true,
    })) as CryptoKey;
  } catch {
    // Sin re-throw del error original: `importPKCS8` puede incluir el PEM
    // (o fragmentos) en el mensaje, y stack traces de WebCrypto vuelan a
    // logs Vercel. Truncamos al código abstracto.
    throw new SsoKeyConfigError("key_parse_failed");
  }

  // Derivar pública desde la privada via JWK strip de componentes
  // privados. Para EC P-256: `d` es la única coordenada privada; las
  // públicas son `x` e `y`. Importamos como JWK pública sin `d`.
  const fullJwk = await exportJWK(privateKey);
  const publicJwk = {
    kty: fullJwk.kty,
    crv: fullJwk.crv,
    x: fullJwk.x,
    y: fullJwk.y,
  };
  const publicKey = (await importJWK(publicJwk, SSO_TICKET_ALG, {
    extractable: true,
  })) as CryptoKey;

  return { privateKey, publicKey, kid };
}

/**
 * Lazy singleton del signing key. Primera call parsea el PEM (~1ms cold),
 * subsiguientes retornan el cache (~0). Si el parse falla, el cache se
 * invalida — el siguiente call vuelve a intentar (útil para tests +
 * recovery tras misconfig de env corregido en runtime).
 */
export function loadSigningKey(): Promise<LoadedSigningKey> {
  if (!cached) {
    cached = loadKeyOnce().catch((err) => {
      cached = undefined;
      throw err;
    });
  }
  return cached;
}

/**
 * JWKS público derivado de la signing key. Shape canónica:
 * `{ keys: [{ kty, crv, x, y, alg, use, kid }] }` — un único entry V1.
 *
 * El consumer es `/api/auth/sso-jwks` (S5) y `jwtVerify` en el redeem
 * (S8) via `createRemoteJWKSet`.
 */
export async function loadPublicJwks(): Promise<JSONWebKeySet> {
  const { publicKey, kid } = await loadSigningKey();
  const jwk = await exportJWK(publicKey);
  // exportJWK de una public CryptoKey ya excluye `d` por la WebCrypto
  // spec, pero somos explícitos: tomamos sólo las propiedades públicas
  // conocidas + agregamos los metadatos JWKS (alg, use, kid).
  return {
    keys: [
      {
        kty: jwk.kty,
        crv: jwk.crv,
        x: jwk.x,
        y: jwk.y,
        alg: SSO_TICKET_ALG,
        use: SSO_TICKET_USE,
        kid,
      },
    ],
  };
}

/**
 * Test-only: resetea el singleton para que los tests puedan probar el
 * handling de env stub-eado por test (sin contaminar entre cases). NO
 * usar en runtime — el singleton es invariante de performance.
 */
export function __resetSsoKeyCacheForTests(): void {
  cached = undefined;
}
