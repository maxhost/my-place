import { afterAll, describe, expect, it, vi } from "vitest";

import { endRlsAdminPool, inRlsTx, type RlsTx } from "@/db/__tests__/db-test-pool";

import { getAuthenticatedDbWithVerifier } from "..";

// Feature C · S4 · db-with-verifier: bridge sesión-local-del-custom-domain →
// claims tx-local → RLS. Paralelo a `getAuthenticatedDb` pero acepta un
// verifier inyectable (no hardcodea Neon Auth JWKS).
//
// Pattern de cobertura espejado de `shared/lib/__tests__/auth-db.test.ts`:
//   (1) fail-closed: si el verifier rechaza, el callback NO se invoca
//       (sin pool.connect, sin tx).
//   (2) inspectability del verifier: lo invocamos exactamente una vez con el
//       token recibido — propiedad necesaria para audit/observability.
//   (3) cadena claims→RLS end-to-end vía `inRlsTx`: el JSON inyectado es
//       EXACTAMENTE el que la bridge emite (`JSON.stringify(claims)` via
//       `set_config('request.jwt.claims', $1, true)`) — `true` OBLIGATORIO
//       (pooler de Neon filtraría identidad sin el flag).
//
// La cobertura del happy-path "real" del pool live se delega a S11 smoke
// E2E. Esta suite cubre el contrato del bridge sin tocar la DB de prod.

afterAll(() => endRlsAdminPool());

describe("getAuthenticatedDbWithVerifier — fail-closed", () => {
  it("verifier rechaza → callback NO invocado (sin DB touch)", async () => {
    const verifier = vi.fn().mockRejectedValue(new Error("verifier-rejected"));
    const fn = vi.fn();

    await expect(
      getAuthenticatedDbWithVerifier("opaque-token", verifier, fn),
    ).rejects.toThrow("verifier-rejected");

    expect(verifier).toHaveBeenCalledTimes(1);
    expect(verifier).toHaveBeenCalledWith("opaque-token");
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("getAuthenticatedDbWithVerifier — verifier injectable", () => {
  it("el verifier se invoca exactamente UNA vez con el token exacto", async () => {
    const verifier = vi.fn().mockRejectedValue(new Error("stop"));
    await expect(
      getAuthenticatedDbWithVerifier("token-abc-123", verifier, async () => 0),
    ).rejects.toThrow("stop");
    expect(verifier).toHaveBeenCalledTimes(1);
    expect(verifier.mock.calls[0]).toEqual(["token-abc-123"]);
  });
});

// Cadena claims→RLS espejada de `auth-db.test.ts § "end-to-end"`: validamos
// que el JSON que la bridge inyecta — `JSON.stringify({sub: <neon_user_id>})`
// — pasado via `set_config('request.jwt.claims', $1, true)` produce
// aislamiento por identidad bajo el rol `app_system`. Esto cubre el path
// custom-domain → mismo `sub` que apex → RLS funciona idéntico (cero
// refactor de policies, invariante crítico Feature C).

async function seedPlaceForUser(tx: RlsTx, authSub: string) {
  const [{ id: userId }] = (await tx.seed(
    `INSERT INTO app_user (auth_user_id,email,display_name,handle)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [authSub, `${authSub}@x.com`, authSub.toUpperCase(), `h_${authSub}`],
  )) as Array<{ id: string }>;
  const [{ id: placeId }] = (await tx.seed(
    `INSERT INTO place (slug,name,billing_mode)
     VALUES ($1, $2, 'OWNER_PAYS') RETURNING id`,
    [`place-${authSub}`, `Place ${authSub}`],
  )) as Array<{ id: string }>;
  await tx.seed(
    `INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`,
    [userId, placeId],
  );
  return { userId, placeId };
}

const countVisiblePlaces = async (tx: RlsTx): Promise<number> => {
  const rows = (await tx.q(
    `SELECT count(*)::int AS n FROM place`,
  )) as Array<{ n: number }>;
  return Number(rows[0].n);
};

describe("getAuthenticatedDbWithVerifier — cadena claims→RLS (vía inRlsTx)", () => {
  it("el JSON inyectado por el bridge aísla por sub bajo app_system", async () => {
    await inRlsTx(async (tx) => {
      await seedPlaceForUser(tx, "ssoSubA");
      await seedPlaceForUser(tx, "ssoSubB");

      // El bridge inyecta `JSON.stringify(verifierResult)`. Replicamos el
      // shape EXACTO que `verifyLocalSession` produce (sin host/iat/exp
      // para el path estricto — RLS solo lee ->>'sub'; los extras son
      // no-op pero válidos).
      await tx.asRawClaims(JSON.stringify({ sub: "ssoSubA" }));
      expect(await countVisiblePlaces(tx)).toBe(1); // A ve su place

      await tx.asRawClaims(JSON.stringify({ sub: "ssoSubB" }));
      expect(await countVisiblePlaces(tx)).toBe(1); // B ve el suyo

      await tx.asRawClaims(""); // sin claim → 0
      expect(await countVisiblePlaces(tx)).toBe(0);
    });
  });

  it("claims con shape extendido (sub+host+iss+iat+exp) NO rompen RLS (extras ignorados)", async () => {
    await inRlsTx(async (tx) => {
      await seedPlaceForUser(tx, "ssoSubExtended");

      // Verifier real (`verifyLocalSession`) retorna LocalSessionClaims
      // completo. La bridge serializa el objeto entero → RLS extrae solo
      // ->>'sub'; los otros claims son no-op pero deben ser válidos JSON.
      await tx.asRawClaims(
        JSON.stringify({
          iss: "place.community",
          sub: "ssoSubExtended",
          host: "nocodecompany.co",
          iat: 1_700_000_000,
          exp: 1_700_604_800,
        }),
      );
      expect(await countVisiblePlaces(tx)).toBe(1);
    });
  });
});
