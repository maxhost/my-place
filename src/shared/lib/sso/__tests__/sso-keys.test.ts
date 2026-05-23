import { exportPKCS8, generateKeyPair } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Feature C · S2 · sso-keys: carga `PLACE_SSO_SIGNING_KEY` (PKCS8 PEM
// ES256) + deriva pública para JWKS. ADR-0032 §"Single-key V1".
//
// Invariantes verificados acá (los unit-testables; los E2E vienen en S5/S8):
// - env ausente / kid ausente / PEM inválido → `SsoKeyConfigError` con
//   código específico (no `Error` genérico).
// - El mensaje del error JAMÁS contiene el PEM (regression de
//   `docs/gotchas/sso-signing-key-no-log.md`).
// - `loadSigningKey` es singleton: dos calls retornan la misma promesa.
// - `loadPublicJwks` deriva JWK pública sin el componente privado `d`.

import {
  __resetSsoKeyCacheForTests,
  SsoKeyConfigError,
  loadPublicJwks,
  loadSigningKey,
} from "../sso-keys";

// Genera un PKCS8 PEM ES256 random para no depender de un fixture
// committeado (los fixtures de keys son anti-pattern: pueden filtrarse).
async function freshTestPem(): Promise<string> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return exportPKCS8(privateKey);
}

beforeEach(() => {
  __resetSsoKeyCacheForTests();
});

afterEach(() => {
  __resetSsoKeyCacheForTests();
  vi.unstubAllEnvs();
});

describe("S2 sso-keys — loadSigningKey + loadPublicJwks", () => {
  it("happy path: con env válida retorna privateKey + publicKey + kid", async () => {
    const pem = await freshTestPem();
    vi.stubEnv("PLACE_SSO_SIGNING_KEY", pem);
    vi.stubEnv("PLACE_SSO_SIGNING_KEY_KID", "test-kid-001");

    const loaded = await loadSigningKey();
    expect(loaded.kid).toBe("test-kid-001");
    // CryptoKey shape (WebCrypto): type + algorithm.name presentes.
    expect(loaded.privateKey).toBeDefined();
    expect(loaded.publicKey).toBeDefined();
    expect((loaded.privateKey as CryptoKey).type).toBe("private");
    expect((loaded.publicKey as CryptoKey).type).toBe("public");
  });

  it("env_missing_key: sin PLACE_SSO_SIGNING_KEY → SsoKeyConfigError('env_missing_key')", async () => {
    vi.stubEnv("PLACE_SSO_SIGNING_KEY", "");
    vi.stubEnv("PLACE_SSO_SIGNING_KEY_KID", "test-kid-001");

    await expect(loadSigningKey()).rejects.toMatchObject({
      name: "SsoKeyConfigError",
      code: "env_missing_key",
    });
  });

  it("env_missing_kid: sin PLACE_SSO_SIGNING_KEY_KID → SsoKeyConfigError('env_missing_kid')", async () => {
    const pem = await freshTestPem();
    vi.stubEnv("PLACE_SSO_SIGNING_KEY", pem);
    vi.stubEnv("PLACE_SSO_SIGNING_KEY_KID", "");

    await expect(loadSigningKey()).rejects.toMatchObject({
      name: "SsoKeyConfigError",
      code: "env_missing_kid",
    });
  });

  it("key_parse_failed: PEM inválido → SsoKeyConfigError('key_parse_failed') sin filtrar contenido", async () => {
    // Secret-shaped basura: si el error message la incluye, la lóggea.
    const malformedPem =
      "-----BEGIN PRIVATE KEY-----\nSECRET-MARKER-DO-NOT-LEAK\n-----END PRIVATE KEY-----\n";
    vi.stubEnv("PLACE_SSO_SIGNING_KEY", malformedPem);
    vi.stubEnv("PLACE_SSO_SIGNING_KEY_KID", "test-kid-001");

    const err = await loadSigningKey().then(
      () => {
        throw new Error("should have thrown");
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SsoKeyConfigError);
    expect((err as SsoKeyConfigError).code).toBe("key_parse_failed");
    // Regression docs/gotchas/sso-signing-key-no-log.md: nunca incluir el
    // PEM en el mensaje (los stack traces pueden terminar en logs Vercel).
    const msg = (err as Error).message;
    expect(msg).not.toContain("SECRET-MARKER-DO-NOT-LEAK");
    expect(msg).not.toContain("BEGIN PRIVATE KEY");
  });

  it("loadPublicJwks: shape correcto, alg=ES256, use=sig, kid, SIN componente privado d", async () => {
    const pem = await freshTestPem();
    vi.stubEnv("PLACE_SSO_SIGNING_KEY", pem);
    vi.stubEnv("PLACE_SSO_SIGNING_KEY_KID", "test-kid-002");

    const jwks = await loadPublicJwks();
    expect(jwks.keys).toHaveLength(1);
    const k = jwks.keys[0] as Record<string, unknown>;
    expect(k.kty).toBe("EC");
    expect(k.crv).toBe("P-256");
    expect(k.alg).toBe("ES256");
    expect(k.use).toBe("sig");
    expect(k.kid).toBe("test-kid-002");
    expect(typeof k.x).toBe("string");
    expect(typeof k.y).toBe("string");
    // Defense-in-depth: `d` es el componente privado de EC; NUNCA debe
    // aparecer en el JWKS público (sería leak total de la signing key).
    expect(k.d).toBeUndefined();
  });

  it("singleton: dos calls a loadSigningKey retornan resultado idéntico (no reparsea)", async () => {
    const pem = await freshTestPem();
    vi.stubEnv("PLACE_SSO_SIGNING_KEY", pem);
    vi.stubEnv("PLACE_SSO_SIGNING_KEY_KID", "test-kid-003");

    const first = await loadSigningKey();
    const second = await loadSigningKey();
    // Misma referencia de privateKey: confirma cache hit (no se reparsea
    // el PEM en cada call, cold-start cost amortizado).
    expect(second.privateKey).toBe(first.privateKey);
    expect(second.publicKey).toBe(first.publicKey);
    expect(second.kid).toBe(first.kid);
  });
});
