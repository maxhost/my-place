import {
  type CryptoKey,
  type JSONWebKeySet,
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";

// Feature C · S2 · sso-ticket: mint + verify del JWT ES256 corto
// (ADR-0032 §"Decisión 3 — Ticket claims"). Mismo patrón de testing que
// `src/shared/lib/__tests__/jwt.test.ts`: keypair efímera por suite +
// JWKS local inyectado al verifier (sin red, sin env).
//
// Cubre los 9 paths críticos:
// 1. buildTicketClaims determinístico (pure function).
// 2. round-trip happy path (sign → verify mismo payload).
// 3. JWS header incluye `kid` (S5 redeem usará para multi-key V2).
// 4. expired (`exp` en el pasado) → SsoTicketError('expired').
// 5. aud_mismatch → SsoTicketError('aud_mismatch').
// 6. iss_mismatch (issuer fabricado ≠ SSO_TICKET_ISSUER) → 'iss_mismatch'.
// 7. signature_invalid (firmado con otra key) → 'signature_invalid'.
// 8. jwt_malformed (basura no-JWT) → 'jwt_malformed'.
// 9. missing_claim (nonce empty string) → 'missing_claim'.

import {
  SSO_TICKET_ISSUER,
  SSO_TICKET_TTL_SECONDS,
  SsoTicketError,
  buildTicketClaims,
  signSsoTicket,
  verifySsoTicket,
} from "../sso-ticket";

const TEST_KID = "test-ticket-kid-001";
const NOW = 1_700_000_000;

let validPrivateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

// Helper: construir claims base que round-trip (no expirado, aud que vamos
// a verificar). Default `nowSeconds` = ahora real para que `exp` quede en
// el futuro vs Date.now() del verify (jose mide exp contra la wall clock,
// no es inyectable). El test determinístico #1 NO usa este helper (pasa
// `nowSeconds` fijo + no verifica).
function baseClaims(overrides: { nowSeconds?: number; aud?: string } = {}) {
  return buildTicketClaims({
    sub: "neon-auth-user-1",
    aud: overrides.aud ?? "nocodecompany.co",
    nonce: "nonce-abc",
    state: "state-xyz",
    jti: "jti-deterministic-001",
    nowSeconds: overrides.nowSeconds ?? Math.floor(Date.now() / 1000),
  });
}

beforeAll(async () => {
  const kp = await generateKeyPair("ES256", { extractable: true });
  validPrivateKey = kp.privateKey;
  const jwk = {
    ...(await exportJWK(kp.publicKey)),
    alg: "ES256",
    kid: TEST_KID,
    use: "sig",
  };
  const set: JSONWebKeySet = { keys: [jwk] };
  jwks = createLocalJWKSet(set);

  const otherKp = await generateKeyPair("ES256", { extractable: true });
  otherPrivateKey = otherKp.privateKey;
});

describe("S2 sso-ticket — buildTicketClaims (pure)", () => {
  it("determinístico: mismos inputs → mismo output (iat=nowSeconds, exp=iat+60s)", () => {
    const a = buildTicketClaims({
      sub: "sub-1",
      aud: "host.com",
      nonce: "n",
      state: "s",
      jti: "j",
      nowSeconds: NOW,
    });
    const b = buildTicketClaims({
      sub: "sub-1",
      aud: "host.com",
      nonce: "n",
      state: "s",
      jti: "j",
      nowSeconds: NOW,
    });
    expect(a).toEqual(b);
    expect(a.iss).toBe(SSO_TICKET_ISSUER);
    expect(a.iat).toBe(NOW);
    expect(a.exp).toBe(NOW + SSO_TICKET_TTL_SECONDS);
    expect(a.sub).toBe("sub-1");
    expect(a.aud).toBe("host.com");
    expect(a.nonce).toBe("n");
    expect(a.state).toBe("s");
    expect(a.jti).toBe("j");
  });
});

describe("S2 sso-ticket — sign + verify", () => {
  it("round-trip happy path: claims firmados + verificados retornan el mismo payload", async () => {
    const claims = baseClaims();
    const token = await signSsoTicket({
      claims,
      privateKey: validPrivateKey,
      kid: TEST_KID,
    });
    const verified = await verifySsoTicket({
      token,
      expectedAud: claims.aud,
      keys: jwks,
    });
    expect(verified.iss).toBe(claims.iss);
    expect(verified.sub).toBe(claims.sub);
    expect(verified.aud).toBe(claims.aud);
    expect(verified.nonce).toBe(claims.nonce);
    expect(verified.state).toBe(claims.state);
    expect(verified.jti).toBe(claims.jti);
    expect(verified.iat).toBe(claims.iat);
    expect(verified.exp).toBe(claims.exp);
  });

  it("JWS header incluye {alg:'ES256', kid:'<kid pasado>'}", async () => {
    const claims = baseClaims();
    const token = await signSsoTicket({
      claims,
      privateKey: validPrivateKey,
      kid: TEST_KID,
    });
    // Compact JWS = header.payload.signature, los tres base64url.
    const [headerB64] = token.split(".");
    // base64url → base64 estándar para Buffer.from().
    const padded = headerB64.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(padded, "base64").toString("utf8");
    const header = JSON.parse(json) as { alg?: string; kid?: string };
    expect(header.alg).toBe("ES256");
    expect(header.kid).toBe(TEST_KID);
  });

  it("expired: claims con exp en el pasado → SsoTicketError('expired')", async () => {
    // Construimos claims expirados pasando un nowSeconds antiguo, y luego
    // pisamos exp para que sea explícitamente anterior a Date.now() real.
    const past = Math.floor(Date.now() / 1000) - 3600;
    const claims = {
      ...baseClaims({ nowSeconds: past }),
      iat: past,
      exp: past + 1, // exp < now real
    };
    const token = await signSsoTicket({
      claims,
      privateKey: validPrivateKey,
      kid: TEST_KID,
    });
    await expect(
      verifySsoTicket({ token, expectedAud: claims.aud, keys: jwks }),
    ).rejects.toMatchObject({ name: "SsoTicketError", code: "expired" });
  });

  it("aud_mismatch: ticket aud='a.com', verify expectedAud='b.com' → 'aud_mismatch'", async () => {
    const claims = baseClaims({ aud: "a.com" });
    const token = await signSsoTicket({
      claims,
      privateKey: validPrivateKey,
      kid: TEST_KID,
    });
    await expect(
      verifySsoTicket({ token, expectedAud: "b.com", keys: jwks }),
    ).rejects.toMatchObject({ name: "SsoTicketError", code: "aud_mismatch" });
  });

  it("iss_mismatch: iss fabricado ≠ SSO_TICKET_ISSUER → 'iss_mismatch'", async () => {
    // buildTicketClaims hardcodea iss; bypaseamos construyendo el JWT
    // directamente con SignJWT y setIssuer('evil.com').
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      nonce: "n",
      state: "s",
    })
      .setProtectedHeader({ alg: "ES256", kid: TEST_KID })
      .setIssuer("evil.com")
      .setSubject("sub-1")
      .setAudience("host.com")
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .setJti("j")
      .sign(validPrivateKey);
    await expect(
      verifySsoTicket({ token, expectedAud: "host.com", keys: jwks }),
    ).rejects.toMatchObject({ name: "SsoTicketError", code: "iss_mismatch" });
  });

  it("signature_invalid: firmado con otra key → 'signature_invalid'", async () => {
    const claims = baseClaims();
    const token = await signSsoTicket({
      claims,
      privateKey: otherPrivateKey, // ≠ la del JWKS
      kid: TEST_KID,
    });
    await expect(
      verifySsoTicket({ token, expectedAud: claims.aud, keys: jwks }),
    ).rejects.toMatchObject({
      name: "SsoTicketError",
      code: "signature_invalid",
    });
  });

  it("jwt_malformed: 'no-es-un-jwt' → 'jwt_malformed'", async () => {
    await expect(
      verifySsoTicket({
        token: "no-es-un-jwt",
        expectedAud: "host.com",
        keys: jwks,
      }),
    ).rejects.toMatchObject({
      name: "SsoTicketError",
      code: "jwt_malformed",
    });
  });

  it("missing_claim: nonce empty string → 'missing_claim'", async () => {
    // Firma manual bypaseando buildTicketClaims para inyectar nonce vacío.
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      nonce: "",
      state: "s",
    })
      .setProtectedHeader({ alg: "ES256", kid: TEST_KID })
      .setIssuer(SSO_TICKET_ISSUER)
      .setSubject("sub-1")
      .setAudience("host.com")
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .setJti("j")
      .sign(validPrivateKey);
    const err = await verifySsoTicket({
      token,
      expectedAud: "host.com",
      keys: jwks,
    }).then(
      () => {
        throw new Error("should have thrown");
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SsoTicketError);
    expect((err as SsoTicketError).code).toBe("missing_claim");
  });
});
