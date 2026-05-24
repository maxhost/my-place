import {
  type CryptoKey,
  type JSONWebKeySet,
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
} from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getAuthenticatedDb } from "@/shared/lib/db";
import { verifyAccessToken } from "@/shared/lib/jwt";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "@/db/__tests__/db-test-pool";

// S4a: contrato de `getAuthenticatedDb` (la costura sesión→claims→RLS).
// (1) fail-closed: token inválido → rechaza ANTES de tocar la DB.
// (2) cadena verify→claims→RLS end-to-end contra `test` (reusa inRlsTx):
//     un JWT bien firmado → verifyAccessToken → claims COMPLETOS inyectados
//     tx-local EXACTAMENTE como getAuthenticatedDb (set_config(...,true)) →
//     app.current_user_id() aísla por identidad. Bajo `app_system`, nunca admin.

afterAll(() => endRlsAdminPool());

let jwks: ReturnType<typeof createLocalJWKSet>;
let key: CryptoKey;

beforeAll(async () => {
  const kp = await generateKeyPair("EdDSA", { extractable: true });
  key = kp.privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), alg: "EdDSA", kid: "k1" };
  const set: JSONWebKeySet = { keys: [jwk] };
  jwks = createLocalJWKSet(set);
});

const token = (sub: string) =>
  new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);

async function seedPlaceA(tx: RlsTx) {
  const [{ id: uA }] = (await tx.seed(
    `INSERT INTO app_user (auth_user_id,email,display_name,handle)
     VALUES ('authA','a@x.com','A','handle_a') RETURNING id`,
  )) as Array<{ id: string }>;
  // ADR-0035 §2: founder = primer owner (uA).
  const [{ id: pid }] = (await tx.seed(
    `INSERT INTO place (slug,name,billing_mode,founder_user_id)
     VALUES ('place-a','Place A','OWNER_PAYS',$1) RETURNING id`,
    [uA],
  )) as Array<{ id: string }>;
  await tx.seed(`INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`, [
    uA,
    pid,
  ]);
  return { pid };
}

const countPlace = async (tx: RlsTx) =>
  Number(
    ((await tx.q(`SELECT count(*)::int n FROM place`)) as Array<{ n: number }>)[0]
      .n,
  );

describe("getAuthenticatedDb — fail-closed", () => {
  it("token inválido → rechaza sin invocar el callback (no toca la DB)", async () => {
    const fn = vi.fn();
    await expect(getAuthenticatedDb("no-es-un-jwt", fn)).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("cadena verify→claims→RLS end-to-end (contra `test`)", () => {
  it("los claims verificados, inyectados tx-local, aíslan por identidad", async () => {
    const claimsA = await verifyAccessToken(await token("authA"), jwks);
    const claimsB = await verifyAccessToken(await token("authB"), jwks);
    await inRlsTx(async (tx) => {
      await seedPlaceA(tx);
      // inyección IDÉNTICA a getAuthenticatedDb: el JSON COMPLETO de claims
      // (sub + iat + exp) — app.current_user_id() extrae ->>'sub'.
      await tx.asRawClaims(JSON.stringify(claimsA));
      expect(await countPlace(tx)).toBe(1); // A ve su place

      await tx.asRawClaims(JSON.stringify(claimsB));
      expect(await countPlace(tx)).toBe(0); // B no ve nada

      await tx.asRawClaims(""); // sin claim
      expect(await countPlace(tx)).toBe(0);
    });
  });
});
