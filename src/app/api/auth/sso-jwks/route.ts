import { loadPublicJwks } from "@/shared/lib/sso";

// Feature C · S5 · /api/auth/sso-jwks: endpoint público apex que expone el
// JWKS derivado de la signing key. ADR-0032 §"Decisión 4 — JWKS publication".
//
// ## Rol en el flow Signed Ticket
//
// El redeem en custom domain (S8) verifica firma del ticket recibido del
// apex contra este endpoint via `jose.createRemoteJWKSet(new URL(...))`.
// Pattern paralelo al de Neon Auth: `shared/lib/jwt.ts` consume el JWKS
// remoto de Neon (`/.well-known/jwks.json` del IdP) — acá Place ES el IdP
// equivalente. La separación apex↔custom domain hace que el custom domain
// no tenga acceso a la signing key privada; sólo a la pública via HTTP.
//
// ## Configuración de runtime
//
// - `runtime = 'nodejs'` — `loadPublicJwks` usa WebCrypto que Edge Runtime
//   soporta, pero la signing key vive en env vars Node-only (`process.env`).
//   Defensive: forzar nodejs evita auto-flip silencioso al edge si una
//   futura dep cambia su signature.
// - `dynamic = 'force-dynamic'` — el JWKS se deriva del env runtime; Next
//   NO debe intentar pre-renderizarlo al build (cuando la env no está
//   seteada todavía en algunos pipelines). El `Cache-Control` del response
//   gobierna el caching del cliente/CDN, no el de Next.
//
// ## Cache strategy
//
// `public, max-age=300, s-maxage=300` (5min). El JWKS cambia sólo en
// rotation (90d manual V1, ADR-0032 §"Operational"). 5min es trade-off:
// suficientemente largo para amortizar fetch en cold-starts del redeem,
// suficientemente corto para que post-rotation los custom domains
// recojan la nueva key en máximo 5min sin reload. `createRemoteJWKSet` de
// jose tiene un cooldown propio que rebajar el load efectivo aún más.
//
// ## Seguridad
//
// - **Público por design.** El JWKS expone sólo la coordenada pública
//   (kty/crv/x/y/alg/use/kid). RFC 7517 §8.5 — JWKS endpoints son
//   públicos por definición. Sin auth.
// - **`d` jamás presente.** `loadPublicJwks` deriva la pública desde la
//   privada vía `exportJWK` de un CryptoKey público; defensa-en-profundidad
//   en `sso-keys.ts` ya cubre. Unit test del endpoint regresa `expect(k.d).toBeUndefined()`.
// - **Content-Type canónico.** `application/jwk-set+json` (RFC 7517 §8.5).
//   Clientes tipo `createRemoteJWKSet` no validan media-type, pero proxies/
//   CDN sí pueden filtrar por él.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const jwks = await loadPublicJwks();
  return new Response(JSON.stringify(jwks), {
    status: 200,
    headers: {
      "Content-Type": "application/jwk-set+json",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
