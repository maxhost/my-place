import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";

// Feature D · S3 (ADR-0035 §Decisión 2 CU3, 2026-05-24) — segundo mutador
// DEFINER. Canaliza el único DELETE en `place_ownership` post-WORM-via-DEFINER
// de S1. La función con la mayor superficie de invariantes (6 pre-conditions)
// de las 4 DEFINER de Feature D.
//
// `app.revoke_ownership(p_target_user_id text, p_place_id text) RETURNS void`
// SECURITY DEFINER LANGUAGE plpgsql. Pre-conditions in body (orden importa):
//   1. caller autenticado (28000 si claim vacío)                — T8
//   2. caller is owner del place (P0001 'caller is not an owner of this place') — T4/T6
//   3. target is owner del place (P0001 'target is not an owner of this place') — T5/T10
//   4. target NOT founder (P0001 'cannot revoke founder ownership')              — T2/T7
//   5. target NOT caller (P0001 'cannot self-revoke ownership; use transfer or
//      future step-down')                                       — T3
//   6. count(owners) > 1 defense-in-depth (P0001 'cannot revoke the only
//      remaining owner')                                        — unreachable
//      post #4 (founder único → count≥2 si target≠founder), pero documentado
//      explícito por resistencia a refactors futuros del modelo (ADR-0035 §4).
//
// Orden founder-check ANTES de self-revoke: caso patológico caller=target=
// founder (T7) gana con 'cannot revoke founder', NO con 'self-revoke'. archived_at
// del place NO bloquea revoke (decisión operativa §spec) — T9.
//
// Patrón seed-as-`neondb_owner` / assert-as-`app_system` heredado de
// `elevate-to-owner.test.ts` (S2) y `rls-place-ownership.test.ts` (S1).
// ROLLBACK siempre.

afterAll(() => endRlsAdminPool());

const APP_USER = `INSERT INTO app_user (auth_user_id,email,display_name,handle)
                  VALUES ($1,$2,'X',$3) RETURNING id`;
const PLACE = `INSERT INTO place (slug,name,billing_mode,founder_user_id,archived_at)
               VALUES ($1,$2,'OWNER_PAYS',$3,$4) RETURNING id`;

// Escenario canónico S3:
//   place-a        (active):   founder=alice, owners=[alice,bob], members=[alice,bob,carol]
//   place-b        (active):   founder=eve,   owners=[eve],       members=[eve]
//   place-archived (archived): founder=alice, owners=[alice,bob], members=[alice,bob]
//   place-solo     (active):   founder=alice, owners=[alice],     members=[alice]
// Cubre los 10 tests mapping 1:1 con tests.md §S3.
async function seedScenario(tx: RlsTx) {
  const [{ id: uA }] = (await tx.seed(APP_USER, ["authA", "a@x.com", "h_a"])) as Array<{ id: string }>;
  const [{ id: uB }] = (await tx.seed(APP_USER, ["authB", "b@x.com", "h_b"])) as Array<{ id: string }>;
  const [{ id: uC }] = (await tx.seed(APP_USER, ["authC", "c@x.com", "h_c"])) as Array<{ id: string }>;
  const [{ id: uE }] = (await tx.seed(APP_USER, ["authE", "e@x.com", "h_e"])) as Array<{ id: string }>;

  const [{ id: pidA }] = (await tx.seed(PLACE, ["place-a", "Place A", uA, null])) as Array<{ id: string }>;
  const [{ id: pidB }] = (await tx.seed(PLACE, ["place-b", "Place B", uE, null])) as Array<{ id: string }>;
  const [{ id: pidArc }] = (await tx.seed(PLACE, [
    "place-archived",
    "Place Archived",
    uA,
    new Date().toISOString(),
  ])) as Array<{ id: string }>;
  const [{ id: pidSolo }] = (await tx.seed(PLACE, ["place-solo", "Place Solo", uA, null])) as Array<{ id: string }>;

  await tx.seed(
    `INSERT INTO place_ownership (user_id,place_id,granted_at) VALUES
     ($1,$2, now() - interval '2 hours'),
     ($3,$2, now() - interval '1 hour'),
     ($4,$5, now()),
     ($1,$6, now() - interval '2 hours'),
     ($3,$6, now() - interval '1 hour'),
     ($1,$7, now())`,
    [uA, pidA, uB, uE, pidB, pidArc, pidSolo],
  );

  // Memberships: carol intencionalmente sólo en place-a sin ownership (T4
  // caller no-owner + T5 target no-owner). Eve aislada en place-b (T6/T10
  // cross-place).
  await tx.seed(
    `INSERT INTO membership (user_id,place_id) VALUES
     ($1,$2),($3,$2),($4,$2),
     ($5,$6),
     ($1,$7),($3,$7),
     ($1,$8)`,
    [uA, pidA, uB, uC, uE, pidB, pidArc, pidSolo],
  );

  return { uA, uB, uC, uE, pidA, pidB, pidArc, pidSolo };
}

// Captura el error de una query bajo SAVEPOINT (mismo helper que S2). Un stmt
// fallido aborta la tx en PG; el SP preserva el resto. Retorna code+message
// o {null,null} si la query no falló.
async function captureError(
  tx: RlsTx,
  sql: string,
  params?: unknown[],
): Promise<{ code: string | null; message: string | null }> {
  await tx.q("SAVEPOINT sp_err");
  let result: { code: string | null; message: string | null } = { code: null, message: null };
  try {
    await tx.q(sql, params);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    result = { code: err.code ?? null, message: err.message ?? null };
  }
  await tx.q("ROLLBACK TO SAVEPOINT sp_err");
  await tx.q("RELEASE SAVEPOINT sp_err");
  return result;
}

// Count via admin bypass (RLS independiente del claim del caller). Usado
// cuando bajo el claim del caller no se ven las filas (po_sel filtra rows
// si caller no es owner del place). Defense-in-depth queries de assert.
const countOwnersAdmin = async (tx: RlsTx, pid: string) =>
  ((await tx.seed(`SELECT count(*)::int n FROM place_ownership WHERE place_id=$1`, [pid])) as Array<{
    n: number;
  }>)[0].n;

describe("S3 app.revoke_ownership — DEFINER mutator CU3 (ADR-0035 §Decisión 2)", () => {
  // T1: happy — alice (founder+owner) revoca bob (co-owner) en place-a.
  // Post: 1 owner restante (alice founder); membership de bob preservada
  // (revoke ≠ expulsión, spec §"Remoción de owner ≠ expulsión del place").
  it("happy: caller owner + target co-owner → DELETE ownership; membership preserved", async () => {
    await inRlsTx(async (tx) => {
      const { uA, uB, pidA } = await seedScenario(tx);
      await tx.as("authA");
      await tx.q(`SELECT app.revoke_ownership($1, $2)`, [uB, pidA]);
      expect(await countOwnersAdmin(tx, pidA)).toBe(1);
      const rows = (await tx.seed(
        `SELECT user_id FROM place_ownership WHERE place_id=$1`,
        [pidA],
      )) as Array<{ user_id: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(uA);
      const mem = (await tx.seed(
        `SELECT count(*)::int n FROM membership WHERE place_id=$1 AND user_id=$2 AND left_at IS NULL`,
        [pidA, uB],
      )) as Array<{ n: number }>;
      expect(mem[0].n).toBe(1);
    });
  });

  // T2: target = founder. bob (co-owner no-founder) intenta revocar alice
  // (founder). Founder-check primario: rechaza por invariante slot único.
  it("denial: target is founder → P0001 'cannot revoke founder ownership'", async () => {
    await inRlsTx(async (tx) => {
      const { uA, pidA } = await seedScenario(tx);
      await tx.as("authB");
      const err = await captureError(tx, `SELECT app.revoke_ownership($1, $2)`, [uA, pidA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/cannot revoke founder/i);
      expect(await countOwnersAdmin(tx, pidA)).toBe(2);
    });
  });

  // T3: target = caller (auto-revoke). bob (co-owner) intenta revocarse a sí
  // mismo. V1 bloquea explícito (V1.1+ podría agregar step_down_as_owner).
  it("denial: target = caller (self-revoke) → P0001 'cannot self-revoke ownership'", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pidA } = await seedScenario(tx);
      await tx.as("authB");
      const err = await captureError(tx, `SELECT app.revoke_ownership($1, $2)`, [uB, pidA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/cannot self-revoke/i);
      expect(await countOwnersAdmin(tx, pidA)).toBe(2);
    });
  });

  // T4: caller no-owner. carol (sólo miembro de place-a) intenta revocar bob.
  // Privilege escalation guard primario.
  it("denial: caller no-owner del place → P0001 'caller is not an owner of this place'", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pidA } = await seedScenario(tx);
      await tx.as("authC");
      const err = await captureError(tx, `SELECT app.revoke_ownership($1, $2)`, [uB, pidA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/caller is not an owner/i);
      expect(await countOwnersAdmin(tx, pidA)).toBe(2);
    });
  });

  // T5: target no-owner. alice intenta revocar carol (miembro pero NO owner).
  it("denial: target no-owner del place → P0001 'target is not an owner of this place'", async () => {
    await inRlsTx(async (tx) => {
      const { uC, pidA } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(tx, `SELECT app.revoke_ownership($1, $2)`, [uC, pidA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/target is not an owner/i);
      expect(await countOwnersAdmin(tx, pidA)).toBe(2);
    });
  });

  // T6: cross-place. alice (owner de place-a) intenta revocar eve (owner de
  // place-b) usando p_place_id = place-b. alice NO es owner de place-b →
  // caller-owner check rechaza. El p_place_id discrimina ownership en ese
  // place específico, no "cualquier place del caller".
  it("denial: cross-place (caller no-owner del target place) → 'caller is not an owner'", async () => {
    await inRlsTx(async (tx) => {
      const { uE, pidB } = await seedScenario(tx);
      await tx.as("authA"); // alice NO es owner de place-b
      const err = await captureError(tx, `SELECT app.revoke_ownership($1, $2)`, [uE, pidB]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/caller is not an owner/i);
      expect(await countOwnersAdmin(tx, pidB)).toBe(1);
    });
  });

  // T7: caso patológico N=1 founder + target=founder. alice founder único de
  // place-solo se intenta revocar a sí misma. Pre-condition founder-check
  // ANTES de self-revoke ANTES de count → 'cannot revoke founder' gana. Fija
  // el orden: 'self-revoke' y 'only remaining owner' son unreachable acá.
  // Defensa contra cambios futuros del orden.
  it("denial: N=1 founder + target=founder → 'cannot revoke founder' (founder-check wins)", async () => {
    await inRlsTx(async (tx) => {
      const { uA, pidSolo } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(tx, `SELECT app.revoke_ownership($1, $2)`, [uA, pidSolo]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/cannot revoke founder/i);
      expect(err.message).not.toMatch(/self-revoke/i);
      expect(err.message).not.toMatch(/only remaining owner/i);
      expect(await countOwnersAdmin(tx, pidSolo)).toBe(1);
    });
  });

  // T8: caller anónimo (claim vacío). 28000 estándar PG; el wrapper TS V1.1+
  // lo mapea a UnauthorizedError sin depender del message.
  it("denial: caller sin sesión (claim vacío) → 28000 invalid_authorization_specification", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pidA } = await seedScenario(tx);
      await tx.as(null);
      const err = await captureError(tx, `SELECT app.revoke_ownership($1, $2)`, [uB, pidA]);
      expect(err.code).toBe("28000");
    });
  });

  // T9: place archived NO bloquea revoke (decisión operativa §spec:
  // mantenimiento de places archivados permitido). Defensa contra refactor
  // futuro que agregue check de subscription_status / archived_at.
  it("place archived NO bloquea revoke (decisión operativa §spec)", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pidArc } = await seedScenario(tx);
      await tx.as("authA");
      await tx.q(`SELECT app.revoke_ownership($1, $2)`, [uB, pidArc]);
      expect(await countOwnersAdmin(tx, pidArc)).toBe(1);
    });
  });

  // T10: cross-place by membership. alice (owner de place-a) intenta revocar
  // eve (NO miembro de place-a, owner de place-b). target-owner check rechaza
  // ANTES de tocar membership — un no-miembro nunca aparece en place_ownership
  // del place ajeno por transitividad.
  it("denial: target no-miembro del place (cross-place) → 'target is not an owner'", async () => {
    await inRlsTx(async (tx) => {
      const { uE, pidA } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(tx, `SELECT app.revoke_ownership($1, $2)`, [uE, pidA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/target is not an owner/i);
      expect(await countOwnersAdmin(tx, pidA)).toBe(2);
    });
  });
});
