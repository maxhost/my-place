import { createLocalJWKSet, exportPKCS8, generateKeyPair } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SSO_TICKET_ISSUER,
  __resetSsoKeyCacheForTests,
  buildTicketClaims,
  loadSigningKey,
  signSsoTicket,
  verifySsoTicket,
} from "@/shared/lib/sso";

import { GET } from "../route";

// Feature C · S5 · /api/auth/sso-jwks: endpoint apex que expone el JWKS
// público derivado de la signing key (ADR-0032 §"Decisión 4 — JWKS
// publication"). El redeem en custom domain (S8) lo consume vía
// `createRemoteJWKSet(new URL('https://place.community/api/auth/sso-jwks'))`
// con cache intra-process.
//
// Invariantes verificados acá:
// 1. **200 OK + Content-Type canónico.** `application/jwk-set+json`
//    (RFC 7517 §8.5). El header explícito es contrato público: clientes
//    tipo `jose.createRemoteJWKSet` no validan el media-type, pero
//    proxies/CDN sí pueden filtrar por él.
// 2. **Body shape.** `{keys: [{kty, crv, x, y, alg, use, kid}]}` — un
//    único entry V1 (single-key). El JWKS NO incluye el componente
//    privado `d`; el shape se valida defensivamente (regression contra
//    leak total de la signing key si se reescribe `loadPublicJwks`).
// 3. **Cache-Control.** `public, max-age=300, s-maxage=300` (5min). El
//    JWKS cambia sólo en rotation (90d manual V1) — cache largo es
//    correcto. El redeem en cold-start fetcha una vez por proceso
//    (`createRemoteJWKSet` cachea intra-process).
// 4. **Round-trip end-to-end.** Ticket firmado con `signSsoTicket`
//    usando la misma signing key del endpoint verifica contra
//    `createLocalJWKSet(JSON.parse(body))`. Esto cubre el contrato
//    completo apex↔custom-domain sin necesidad de HTTP real.
// 5. **Público sin auth.** El handler no consume headers/cookies del
//    request — el JWKS es público por definición (RFC 7517). Cualquier
//    futuro patch que agregue auth check rompería este test (regression).

// Pattern paralelo a `sso-keys.test.ts`: PEM ES256 random por suite, sin
// fixture committeado (los fixtures de keys son anti-pattern). Singleton
// reset pre/post para evitar contaminación entre cases.
async function freshTestPem(): Promise<string> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return exportPKCS8(privateKey);
}

beforeEach(() => __resetSsoKeyCacheForTests());
afterEach(() => {
  __resetSsoKeyCacheForTests();
  vi.unstubAllEnvs();
});

describe("S5 sso-jwks endpoint — GET /api/auth/sso-jwks", () => {
  it("200 OK con Content-Type application/jwk-set+json", async () => {
    vi.stubEnv("PLACE_SSO_SIGNING_KEY", await freshTestPem());
    vi.stubEnv("PLACE_SSO_SIGNING_KEY_KID", "kid-test-s5-01");

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/jwk-set+json");
  });

  it("body parsea como JSON canónico {keys:[...]} con shape EC P-256 + sin componente privado d", async () => {
    vi.stubEnv("PLACE_SSO_SIGNING_KEY", await freshTestPem());
    vi.stubEnv("PLACE_SSO_SIGNING_KEY_KID", "kid-test-s5-02");

    const res = await GET();
    const body = (await res.json()) as { keys: Array<Record<string, unknown>> };
    expect(Array.isArray(body.keys)).toBe(true);
    expect(body.keys).toHaveLength(1);
    const k = body.keys[0];
    expect(k.kty).toBe("EC");
    expect(k.crv).toBe("P-256");
    expect(k.alg).toBe("ES256");
    expect(k.use).toBe("sig");
    expect(k.kid).toBe("kid-test-s5-02");
    expect(typeof k.x).toBe("string");
    expect(typeof k.y).toBe("string");
    // Defense-in-depth: `d` es el componente privado de EC; NUNCA debe
    // aparecer en el JWKS público (sería leak total de la signing key).
    expect(k.d).toBeUndefined();
  });

  it("Cache-Control: public, max-age=300, s-maxage=300 (5min)", async () => {
    vi.stubEnv("PLACE_SSO_SIGNING_KEY", await freshTestPem());
    vi.stubEnv("PLACE_SSO_SIGNING_KEY_KID", "kid-test-s5-03");

    const res = await GET();
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=300, s-maxage=300",
    );
  });

  it("round-trip end-to-end: ticket firmado por la signing key verifica contra el JWKS retornado", async () => {
    vi.stubEnv("PLACE_SSO_SIGNING_KEY", await freshTestPem());
    vi.stubEnv("PLACE_SSO_SIGNING_KEY_KID", "kid-test-s5-04");

    // 1. JWKS via endpoint (consumer-side, como lo verá el redeem en S8).
    const res = await GET();
    const jwks = (await res.json()) as Parameters<typeof createLocalJWKSet>[0];

    // 2. Ticket firmado con la misma signing key que el endpoint deriva.
    const { privateKey, kid } = await loadSigningKey();
    const claims = buildTicketClaims({
      sub: "neon-user-abc",
      aud: "nocodecompany.co",
      nonce: "nonce-roundtrip-01",
      state: "state-roundtrip-01",
      jti: "jti-roundtrip-01",
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    const token = await signSsoTicket({ claims, privateKey, kid });

    // 3. Verify usando `createLocalJWKSet(jwks)` — pattern idéntico al S8
    //    redeem (que usa `createRemoteJWKSet` contra este endpoint vía
    //    HTTP). El round-trip confirma que el JWKS expuesto es el correcto
    //    para verificar tickets emitidos con la signing key del apex.
    const verified = await verifySsoTicket({
      token,
      expectedAud: "nocodecompany.co",
      keys: createLocalJWKSet(jwks),
    });
    expect(verified.sub).toBe("neon-user-abc");
    expect(verified.iss).toBe(SSO_TICKET_ISSUER);
    expect(verified.aud).toBe("nocodecompany.co");
    expect(verified.jti).toBe("jti-roundtrip-01");
    expect(verified.nonce).toBe("nonce-roundtrip-01");
    expect(verified.state).toBe("state-roundtrip-01");
  });

  it("público sin auth: handler responde 200 sin consumir Request (regression contra futuro auth check)", async () => {
    // El JWKS es público por definición RFC 7517 §8.5. El handler GET no
    // debe leer headers ni cookies — si futuras versiones agregan algún
    // check (rate limit basado en cookie, auth basada en Authorization,
    // etc.), este test falla intencionalmente para forzar discusión.
    //
    // La llamada `GET()` sin argumento confirma que el handler no
    // requiere Request — si lo necesitara, TypeScript/runtime fallaría.
    vi.stubEnv("PLACE_SSO_SIGNING_KEY", await freshTestPem());
    vi.stubEnv("PLACE_SSO_SIGNING_KEY_KID", "kid-test-s5-05");

    const res = await GET();
    expect(res.status).toBe(200);
  });
});
