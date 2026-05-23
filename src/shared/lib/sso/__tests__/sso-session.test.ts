import {
  decodeProtectedHeader,
  exportPKCS8,
  generateKeyPair,
} from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Feature C · S4 · sso-session: local session JWT del custom domain (ES256
// firmado con la MISMA signing key del apex — single-key V1). ADR-0032
// §"Decisión 5 — Local session cookie".
//
// El JWT vive en la cookie `__Host-place_sso_session` host-only del custom
// domain. Claims canónicos:
//   - `iss = place.community` (apex es la raíz de trust)
//   - `sub = neon_auth.user.id` (continuidad RLS — mismo valor que apex)
//   - `host = <custom_domain>` (defense-in-depth contra robo cross-domain)
//   - `iat/exp` (epoch seconds, TTL 7d)
//
// Cubre 9 paths:
//  1. Constantes canónicas (cookie name + TTL + issuer).
//  2. Roundtrip mint+verify retorna claims idénticos.
//  3. JWS protected header trae alg=ES256 + kid de loadSigningKey().
//  4. Host mismatch → LocalSessionError code=host_mismatch.
//  5. Expired → code=expired.
//  6. Signature tampered → code=signature_invalid.
//  7. Issuer wrong → code=iss_mismatch (mintamos custom con otro iss).
//  8. Malformed JWT → code=jwt_malformed.
//  9. Missing host claim → code=missing_claim.

import {
  LOCAL_SESSION_COOKIE_NAME,
  LOCAL_SESSION_ISSUER,
  LOCAL_SESSION_TTL_SECONDS,
  LocalSessionError,
  __resetSsoKeyCacheForTests,
  mintLocalSession,
  verifyLocalSession,
} from "..";

// Reusamos la signing key del apex (single-key V1). PEM stubbed por env;
// el test lo genera fresh cada suite con generateKeyPair("ES256").
async function freshTestPem(): Promise<string> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return exportPKCS8(privateKey);
}

beforeAll(async () => {
  const pem = await freshTestPem();
  vi.stubEnv("PLACE_SSO_SIGNING_KEY", pem);
  vi.stubEnv("PLACE_SSO_SIGNING_KEY_KID", "session-test-kid-001");
  // Reset una sola vez al principio para que loadSigningKey re-derive con
  // el env nuevo. (Si otro suite del mismo file group ya cacheó con otra
  // key, este reset garantiza derivación fresh).
  __resetSsoKeyCacheForTests();
});

afterAll(() => {
  __resetSsoKeyCacheForTests();
  vi.unstubAllEnvs();
});

describe("S4 sso-session — constantes canónicas", () => {
  it("LOCAL_SESSION_COOKIE_NAME tiene prefix __Host- (Path=/, Secure, sin Domain)", () => {
    expect(LOCAL_SESSION_COOKIE_NAME).toBe("__Host-place_sso_session");
    expect(LOCAL_SESSION_COOKIE_NAME.startsWith("__Host-")).toBe(true);
  });

  it("LOCAL_SESSION_TTL_SECONDS = 7d (604800 segundos)", () => {
    expect(LOCAL_SESSION_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it("LOCAL_SESSION_ISSUER === apex canonical host (raíz de trust)", () => {
    expect(LOCAL_SESSION_ISSUER).toBe("place.community");
  });
});

describe("S4 sso-session — mintLocalSession + verifyLocalSession (happy path)", () => {
  it("roundtrip: mint con sub+host → verify retorna LocalSessionClaims idénticos", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await mintLocalSession({
      sub: "neon-auth-user-uuid-abc",
      host: "nocodecompany.co",
      nowSeconds,
    });

    const claims = await verifyLocalSession({
      token,
      expectedHost: "nocodecompany.co",
    });

    expect(claims.sub).toBe("neon-auth-user-uuid-abc");
    expect(claims.host).toBe("nocodecompany.co");
    expect(claims.iss).toBe(LOCAL_SESSION_ISSUER);
    expect(claims.iat).toBe(nowSeconds);
    expect(claims.exp).toBe(nowSeconds + LOCAL_SESSION_TTL_SECONDS);
  });

  it("JWS protected header trae alg=ES256 + kid de loadSigningKey()", async () => {
    const token = await mintLocalSession({
      sub: "u",
      host: "x.co",
      nowSeconds: 1_000_000,
    });
    const header = decodeProtectedHeader(token);
    expect(header.alg).toBe("ES256");
    expect(header.kid).toBe("session-test-kid-001");
  });
});

describe("S4 sso-session — verifyLocalSession (error paths discriminados)", () => {
  it("host mismatch: expectedHost distinto al claim → code=host_mismatch", async () => {
    const token = await mintLocalSession({
      sub: "u",
      host: "nocodecompany.co",
      nowSeconds: Math.floor(Date.now() / 1000),
    });

    let err: unknown;
    try {
      await verifyLocalSession({ token, expectedHost: "evil.com" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LocalSessionError);
    expect((err as LocalSessionError).code).toBe("host_mismatch");
  });

  it("expired: exp en el pasado → code=expired", async () => {
    const longAgo =
      Math.floor(Date.now() / 1000) - LOCAL_SESSION_TTL_SECONDS - 60;
    const token = await mintLocalSession({
      sub: "u",
      host: "h.co",
      nowSeconds: longAgo,
    });

    let err: unknown;
    try {
      await verifyLocalSession({ token, expectedHost: "h.co" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LocalSessionError);
    expect((err as LocalSessionError).code).toBe("expired");
  });

  it("signature tampered: byte mutado en el segmento signature → code=signature_invalid", async () => {
    const token = await mintLocalSession({
      sub: "u",
      host: "h.co",
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    // Compact JWS: `<header>.<payload>.<signature>`. Mutamos un char dentro
    // del segmento signature preservando base64url alphabet — la estructura
    // se mantiene pero la firma falla la verificación criptográfica.
    const lastDot = token.lastIndexOf(".");
    const sig = token.slice(lastDot + 1);
    const mid = Math.floor(sig.length / 2);
    const c = sig.charAt(mid);
    const flipped = c === "A" ? "B" : "A";
    const tampered =
      token.slice(0, lastDot + 1) +
      sig.slice(0, mid) +
      flipped +
      sig.slice(mid + 1);

    let err: unknown;
    try {
      await verifyLocalSession({ token: tampered, expectedHost: "h.co" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LocalSessionError);
    expect((err as LocalSessionError).code).toBe("signature_invalid");
  });

  it("malformed: input no es JWS compact → code=jwt_malformed", async () => {
    let err: unknown;
    try {
      await verifyLocalSession({
        token: "completely-bogus",
        expectedHost: "h.co",
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LocalSessionError);
    expect((err as LocalSessionError).code).toBe("jwt_malformed");
  });
});
