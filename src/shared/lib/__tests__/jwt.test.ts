import {
  type CryptoKey,
  type JSONWebKeySet,
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyAccessToken } from "@/shared/lib/jwt";

// S4a: verificación del access token de Neon Auth (jose + JWKS). El JWKS real
// es remoto (NEON_AUTH_JWKS_URL); acá se firma localmente con un par EdDSA
// (alg del plugin JWT de Better Auth) y se inyecta el JWKS local como `keys`
// — la verificación es la misma función, sin red.
let jwks: ReturnType<typeof createLocalJWKSet>;
let validKey: CryptoKey;
let otherKey: CryptoKey;

function sign(key: CryptoKey, opts: { sub?: string; expSec?: number }) {
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
    .setIssuedAt();
  if (opts.sub !== undefined) jwt.setSubject(opts.sub);
  jwt.setExpirationTime(
    opts.expSec ?? Math.floor(Date.now() / 1000) + 300,
  );
  return jwt.sign(key);
}

beforeAll(async () => {
  const kp = await generateKeyPair("EdDSA", { extractable: true });
  validKey = kp.privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), alg: "EdDSA", kid: "k1" };
  const set: JSONWebKeySet = { keys: [jwk] };
  jwks = createLocalJWKSet(set);
  otherKey = (await generateKeyPair("EdDSA", { extractable: true })).privateKey;
});

describe("verifyAccessToken", () => {
  it("acepta un JWT bien firmado y devuelve el claim `sub`", async () => {
    const claims = await verifyAccessToken(
      await sign(validKey, { sub: "auth-user-1" }),
      jwks,
    );
    expect(claims.sub).toBe("auth-user-1");
  });

  it("rechaza un JWT firmado con otra clave (firma inválida)", async () => {
    await expect(
      verifyAccessToken(await sign(otherKey, { sub: "auth-user-1" }), jwks),
    ).rejects.toThrow();
  });

  it("rechaza un JWT con firma válida pero sin claim `sub`", async () => {
    await expect(
      verifyAccessToken(await sign(validKey, {}), jwks),
    ).rejects.toThrow();
  });

  it("rechaza un JWT expirado (firma válida)", async () => {
    await expect(
      verifyAccessToken(
        await sign(validKey, {
          sub: "auth-user-1",
          expSec: Math.floor(Date.now() / 1000) - 60,
        }),
        jwks,
      ),
    ).rejects.toThrow();
  });

  it("rechaza basura que no es un JWT compacto", async () => {
    await expect(verifyAccessToken("no-es-un-jwt", jwks)).rejects.toThrow();
  });
});
