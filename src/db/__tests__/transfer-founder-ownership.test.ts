import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";

// Feature D · S4 (ADR-0035 §Decisión 2 CU4, 2026-05-24) — tercer mutador
// DEFINER de Feature D. Operación COMPUESTA atómica: `UPDATE place.
// founder_user_id := p_to_user_id` + `DELETE FROM place_ownership` del caller
// en la misma tx implícita del plpgsql body. El caller cede el founder slot
// y simultáneamente pierde su ownership; el target ya owner asume el slot.
//
// `app.transfer_founder_ownership(p_to_user_id text, p_place_id text) RETURNS void`
// SECURITY DEFINER LANGUAGE plpgsql. Pre-conditions in body (orden importa):
//   1. caller autenticado (28000 si claim vacío)                       — T7
//   2. app_user existe para caller (P0002)                             — implícito
//   3. place exists (P0001 'place not found') — implícito vía v_founder NULL guard
//   4. caller == place.founder_user_id (P0001 'caller is not the founder of this place') — T2/T6
//   5. target is owner of place (P0001 'target is not an owner; elevate first') — T3/T5
//   6. target ≠ caller (P0001 'cannot transfer to self')               — T4
// Post: UPDATE place SET founder_user_id = p_to_user_id + DELETE place_ownership
// del caller. La membership del caller se preserva (revoke ≠ expulsión, spec
// §"Remoción de owner ≠ expulsión del place").
//
// Orden #5 (target=owner) ANTES de #6 (target≠caller): preferimos el mensaje
// 'target is not an owner; elevate first' cuando target no es owner — refuerza
// "no transfer-without-successor" (ADR-0035 §Alternativas rechazadas). Para T4
// (alice→alice, alice IS owner+founder) target=owner pasa, self-check fires
// → 'cannot transfer to self'. Sin conflicto entre órdenes para casos existentes.
//
// `archived_at` del place NO bloquea transfer (decisión operativa §spec —
// mantenimiento de places archivados permitido, mismo criterio que CU3) — T8.
//
// Patrón seed-as-`neondb_owner` / assert-as-`app_system` heredado de S3.
// ROLLBACK siempre.

afterAll(() => endRlsAdminPool());

const APP_USER = `INSERT INTO app_user (auth_user_id,email,display_name,handle)
                  VALUES ($1,$2,'X',$3) RETURNING id`;
const PLACE = `INSERT INTO place (slug,name,billing_mode,founder_user_id,archived_at)
               VALUES ($1,$2,'OWNER_PAYS',$3,$4) RETURNING id`;

// Escenario canónico S4:
//   place-a        (active):   founder=alice, owners=[alice,bob], members=[alice,bob,carol]
//   place-other    (active):   founder=dave,  owners=[dave,bob],  members=[dave,bob]
//   place-archived (archived): founder=alice, owners=[alice,bob], members=[alice,bob]
//   place-solo     (active):   founder=alice, owners=[alice],     members=[alice]
// 4 users: alice (authA, uA), bob (authB, uB), carol (authC, uC), dave (authD, uD).
// Cubre los 10 tests mapping 1:1 con tests.md §S4.
async function seedScenario(tx: RlsTx) {
  const [{ id: uA }] = (await tx.seed(APP_USER, ["authA", "a@x.com", "h_a"])) as Array<{ id: string }>;
  const [{ id: uB }] = (await tx.seed(APP_USER, ["authB", "b@x.com", "h_b"])) as Array<{ id: string }>;
  const [{ id: uC }] = (await tx.seed(APP_USER, ["authC", "c@x.com", "h_c"])) as Array<{ id: string }>;
  const [{ id: uD }] = (await tx.seed(APP_USER, ["authD", "d@x.com", "h_d"])) as Array<{ id: string }>;

  const [{ id: pidA }] = (await tx.seed(PLACE, ["place-a", "Place A", uA, null])) as Array<{ id: string }>;
  const [{ id: pidOther }] = (await tx.seed(PLACE, [
    "place-other",
    "Place Other",
    uD,
    null,
  ])) as Array<{ id: string }>;
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
     ($4,$5, now() - interval '2 hours'),
     ($3,$5, now() - interval '1 hour'),
     ($1,$6, now() - interval '2 hours'),
     ($3,$6, now() - interval '1 hour'),
     ($1,$7, now())`,
    [uA, pidA, uB, uD, pidOther, pidArc, pidSolo],
  );

  // Memberships: carol sólo miembro de place-a (sin ownership) → T3 target no-owner.
  await tx.seed(
    `INSERT INTO membership (user_id,place_id) VALUES
     ($1,$2),($3,$2),($4,$2),
     ($5,$6),($3,$6),
     ($1,$7),($3,$7),
     ($1,$8)`,
    [uA, pidA, uB, uC, uD, pidOther, pidArc, pidSolo],
  );

  return { uA, uB, uC, uD, pidA, pidOther, pidArc, pidSolo };
}

// Captura el error de una query bajo SAVEPOINT (mismo helper que S2/S3). Un
// stmt fallido aborta la tx en PG; el SP preserva el resto. Retorna code+
// message o {null,null} si la query no falló.
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

// Admin bypass para asserts independientes de RLS (post-S1 helper `po_sel`
// filtra rows si caller no es owner del place — los asserts de denial-paths
// requieren la cuenta REAL del schema, no la vista del caller no-owner).
const countOwnersAdmin = async (tx: RlsTx, pid: string) =>
  ((await tx.seed(`SELECT count(*)::int n FROM place_ownership WHERE place_id=$1`, [pid])) as Array<{
    n: number;
  }>)[0].n;

const founderOfAdmin = async (tx: RlsTx, pid: string) =>
  ((await tx.seed(`SELECT founder_user_id FROM place WHERE id=$1`, [pid])) as Array<{
    founder_user_id: string;
  }>)[0].founder_user_id;

describe("S4 app.transfer_founder_ownership — DEFINER mutator CU4 (ADR-0035 §Decisión 2)", () => {
  // T1 happy — alice (founder+owner) transfiere a bob (co-owner). Post:
  // founder=bob; alice deja de ser owner (DELETE); membership de alice
  // preservada. Defense-in-depth: count owners post = 1 (sólo bob).
  it("happy: caller founder + target co-owner → atomic UPDATE founder + DELETE caller ownership; membership preserved", async () => {
    await inRlsTx(async (tx) => {
      const { uA, uB, pidA } = await seedScenario(tx);
      await tx.as("authA");
      await tx.q(`SELECT app.transfer_founder_ownership($1, $2)`, [uB, pidA]);
      expect(await founderOfAdmin(tx, pidA)).toBe(uB);
      const owners = (await tx.seed(`SELECT user_id FROM place_ownership WHERE place_id=$1`, [pidA])) as Array<{
        user_id: string;
      }>;
      expect(owners).toHaveLength(1);
      expect(owners[0].user_id).toBe(uB);
      const mem = (await tx.seed(
        `SELECT count(*)::int n FROM membership WHERE place_id=$1 AND user_id=$2 AND left_at IS NULL`,
        [pidA, uA],
      )) as Array<{ n: number }>;
      expect(mem[0].n).toBe(1);
    });
  });

  // T2 caller no-founder. bob (co-owner pero NO founder) intenta transferir a
  // alice. Caller-founder check rechaza (asimetría founder explícita ADR-0035).
  it("denial: caller is co-owner but not founder → P0001 'caller is not the founder of this place'", async () => {
    await inRlsTx(async (tx) => {
      const { uA, pidA } = await seedScenario(tx);
      await tx.as("authB");
      const err = await captureError(tx, `SELECT app.transfer_founder_ownership($1, $2)`, [uA, pidA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/caller is not the founder/i);
      expect(await founderOfAdmin(tx, pidA)).toBe(uA);
      expect(await countOwnersAdmin(tx, pidA)).toBe(2);
    });
  });

  // T3 target no-owner. alice intenta transferir a carol (miembro de place-a
  // pero NO owner). "no transfer-without-successor" canónico: target debe ser
  // owner pre-existente (elevar primero).
  it("denial: target is member but not owner → P0001 'target is not an owner; elevate first'", async () => {
    await inRlsTx(async (tx) => {
      const { uA, uC, pidA } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(tx, `SELECT app.transfer_founder_ownership($1, $2)`, [uC, pidA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/target is not an owner.*elevate first/i);
      expect(await founderOfAdmin(tx, pidA)).toBe(uA);
      expect(await countOwnersAdmin(tx, pidA)).toBe(2);
    });
  });

  // T4 target = caller. alice (founder+owner) intenta transferir a sí misma.
  // Pre-condition target=owner pasa (alice ES owner), self-check fires.
  it("denial: target equals caller (self-transfer) → P0001 'cannot transfer to self'", async () => {
    await inRlsTx(async (tx) => {
      const { uA, pidA } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(tx, `SELECT app.transfer_founder_ownership($1, $2)`, [uA, pidA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/cannot transfer to self/i);
      expect(await founderOfAdmin(tx, pidA)).toBe(uA);
      expect(await countOwnersAdmin(tx, pidA)).toBe(2);
    });
  });

  // T5 N=1 founder solo + target NOT owner. alice founder único de place-solo
  // intenta transferir a bob (no es owner). target=owner check rechaza con el
  // mensaje canónico "elevate first" — refuerza no-transfer-without-successor.
  it("denial: N=1 founder solo + target not owner → 'target is not an owner; elevate first' (no transfer without successor)", async () => {
    await inRlsTx(async (tx) => {
      const { uA, uB, pidSolo } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(tx, `SELECT app.transfer_founder_ownership($1, $2)`, [uB, pidSolo]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/target is not an owner.*elevate first/i);
      expect(await founderOfAdmin(tx, pidSolo)).toBe(uA);
      expect(await countOwnersAdmin(tx, pidSolo)).toBe(1);
    });
  });

  // T6 cross-place. alice founder de place-a intenta transferir EN place-other
  // a bob (que SÍ es owner de place-other). Caller-founder check rechaza:
  // alice NO es founder de place-other (dave lo es). p_place_id discrimina la
  // foundership en ese place específico, no "cualquier place del caller".
  it("denial: cross-place — caller is founder of another place, not of p_place_id → 'caller is not the founder'", async () => {
    await inRlsTx(async (tx) => {
      const { uB, uD, pidOther } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(tx, `SELECT app.transfer_founder_ownership($1, $2)`, [uB, pidOther]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/caller is not the founder/i);
      expect(await founderOfAdmin(tx, pidOther)).toBe(uD);
      expect(await countOwnersAdmin(tx, pidOther)).toBe(2);
    });
  });

  // T7 caller anónimo. 28000 estándar PG; el wrapper TS V1.1+ lo mapea a
  // UnauthorizedError sin depender del message (compat con S2/S3).
  it("denial: caller sin sesión (claim vacío) → 28000 invalid_authorization_specification", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pidA } = await seedScenario(tx);
      await tx.as(null);
      const err = await captureError(tx, `SELECT app.transfer_founder_ownership($1, $2)`, [uB, pidA]);
      expect(err.code).toBe("28000");
    });
  });

  // T8 place archived NO bloquea transfer (decisión operativa §spec —
  // mantenimiento de places archivados permitido, mismo criterio que CU3 S3).
  // Defensa contra refactor futuro que agregue check de subscription_status.
  it("place archived NO bloquea transfer (decisión operativa §spec)", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pidArc } = await seedScenario(tx);
      await tx.as("authA");
      await tx.q(`SELECT app.transfer_founder_ownership($1, $2)`, [uB, pidArc]);
      expect(await founderOfAdmin(tx, pidArc)).toBe(uB);
      const owners = (await tx.seed(`SELECT user_id FROM place_ownership WHERE place_id=$1`, [pidArc])) as Array<{
        user_id: string;
      }>;
      expect(owners).toHaveLength(1);
      expect(owners[0].user_id).toBe(uB);
    });
  });

  // T9 atomicity contract. plpgsql body es UNA sola tx implícita: UPDATE +
  // DELETE comparten snapshot. Test fija el contrato observable: ambos efectos
  // visibles post-call (no parcial). PG-side no se puede forzar fail mid-body
  // sin trigger custom, pero el contrato queda escrito como invariante.
  it("atomicity contract: UPDATE founder + DELETE caller ownership en misma tx (ambos efectos post-success)", async () => {
    await inRlsTx(async (tx) => {
      const { uA, uB, pidA } = await seedScenario(tx);
      await tx.as("authA");
      await tx.q(`SELECT app.transfer_founder_ownership($1, $2)`, [uB, pidA]);
      const place = (await tx.seed(`SELECT founder_user_id FROM place WHERE id=$1`, [pidA])) as Array<{
        founder_user_id: string;
      }>;
      const ownAlice = (await tx.seed(
        `SELECT count(*)::int n FROM place_ownership WHERE place_id=$1 AND user_id=$2`,
        [pidA, uA],
      )) as Array<{ n: number }>;
      expect(place[0].founder_user_id).toBe(uB);
      expect(ownAlice[0].n).toBe(0);
    });
  });

  // T10 regression post-transfer — 4 asserts independientes en una sola tx:
  // (a) founder=bob, (b) bob owner, (c) alice NOT owner, (d) alice sigue
  // miembro activa. Documenta el contract completo post-success.
  it("regression post-transfer: founder=bob, bob owner, alice NOT owner, alice still active member", async () => {
    await inRlsTx(async (tx) => {
      const { uA, uB, pidA } = await seedScenario(tx);
      await tx.as("authA");
      await tx.q(`SELECT app.transfer_founder_ownership($1, $2)`, [uB, pidA]);
      expect(await founderOfAdmin(tx, pidA)).toBe(uB);
      const bobOwner = (await tx.seed(
        `SELECT count(*)::int n FROM place_ownership WHERE place_id=$1 AND user_id=$2`,
        [pidA, uB],
      )) as Array<{ n: number }>;
      expect(bobOwner[0].n).toBe(1);
      const aliceOwner = (await tx.seed(
        `SELECT count(*)::int n FROM place_ownership WHERE place_id=$1 AND user_id=$2`,
        [pidA, uA],
      )) as Array<{ n: number }>;
      expect(aliceOwner[0].n).toBe(0);
      const aliceMem = (await tx.seed(
        `SELECT count(*)::int n FROM membership WHERE place_id=$1 AND user_id=$2 AND left_at IS NULL`,
        [pidA, uA],
      )) as Array<{ n: number }>;
      expect(aliceMem[0].n).toBe(1);
    });
  });
});
