import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";

// Feature E · S1 (ADR-0036 §1, 2026-05-24) — primer mutador DEFINER del flow
// personal del miembro. Canaliza la edición self-only del headline; el
// UPDATE acotado vive dentro de la función SECURITY DEFINER y siempre filtra
// por `user_id = caller`, aislando column exposure (decisión §"Decisión
// operativa" de `docs/features/members/spec.md` — Path B sobre Path A
// column-level policy).
//
// `app.update_my_headline(p_place_id text, p_new_headline text) RETURNS void`
// SECURITY DEFINER LANGUAGE plpgsql. Pre-conditions in body:
//   1. caller autenticado (28000 si claim vacío)
//   2. app_user existe para el caller (P0002 — edge case, simetría con
//      app.elevate_to_owner)
//   3. caller es active member del place (P0001 'caller is not an active
//      member of this place'; cubre target-no-membership Y target-left_at
//      con la misma condition)
// Body: UPDATE membership SET headline = p_new_headline WHERE user_id =
// caller AND place_id = p_place_id. Sin re-validación de length — delega a
// CHECK constraint (defense-in-depth). Sin path para editar headline de
// otros — la función NO acepta `p_target_user_id`.
//
// Patrón seed-as-owner / assert-as-`app_system` con claim heredado de
// `elevate-to-owner.test.ts`. ROLLBACK siempre.

afterAll(() => endRlsAdminPool());

const APP_USER = `INSERT INTO app_user (auth_user_id,email,display_name,handle)
                  VALUES ($1,$2,'X',$3) RETURNING id`;
// Post-0012: `place.founder_user_id` es NOT NULL.
const PLACE = `INSERT INTO place (slug,name,billing_mode,founder_user_id)
               VALUES ($1,$2,'OWNER_PAYS',$3) RETURNING id`;

// Escenario canónico S1 update_my_headline: 1 place creado por alice (founder
// + owner) + bob/carol como miembros activos + eve como ex-miembro (left_at
// NOT NULL) + dave sin membership en place.
async function seedScenario(tx: RlsTx) {
  const [{ id: uA }] = (await tx.seed(APP_USER, ["authA", "a@x.com", "h_a"])) as Array<{ id: string }>;
  const [{ id: uB }] = (await tx.seed(APP_USER, ["authB", "b@x.com", "h_b"])) as Array<{ id: string }>;
  const [{ id: uC }] = (await tx.seed(APP_USER, ["authC", "c@x.com", "h_c"])) as Array<{ id: string }>;
  const [{ id: uD }] = (await tx.seed(APP_USER, ["authD", "d@x.com", "h_d"])) as Array<{ id: string }>;
  const [{ id: uE }] = (await tx.seed(APP_USER, ["authE", "e@x.com", "h_e"])) as Array<{ id: string }>;
  const [{ id: pid }] = (await tx.seed(PLACE, ["place-a", "Place A", uA])) as Array<{ id: string }>;
  await tx.seed(`INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`, [uA, pid]);
  await tx.seed(
    `INSERT INTO membership (user_id,place_id,left_at) VALUES
     ($1,$2,NULL),
     ($3,$2,NULL),
     ($4,$2,NULL),
     ($5,$2, now())`,
    [uA, pid, uB, uC, uE],
  );
  return { uA, uB, uC, uD, uE, pid };
}

// SAVEPOINT-based error capture (mismo helper que elevate-to-owner.test.ts).
async function captureError(
  tx: RlsTx,
  sql: string,
  params?: unknown[],
): Promise<{ code: string | null; message: string | null }> {
  await tx.q("SAVEPOINT sp_err");
  let result: { code: string | null; message: string | null } = {
    code: null,
    message: null,
  };
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

// Lee el headline actual via seed (admin bypass) — el caller bajo `app_system`
// con claim distinto al owner del place no vería la fila (RLS owner-only).
async function readHeadline(tx: RlsTx, userId: string, placeId: string) {
  const rows = (await tx.seed(
    `SELECT headline FROM membership WHERE user_id = $1 AND place_id = $2`,
    [userId, placeId],
  )) as Array<{ headline: string | null }>;
  return rows[0]?.headline ?? null;
}

describe("S1 app.update_my_headline — DEFINER self-edit (ADR-0036 §3 + spec §Decisión operativa)", () => {
  // T1: happy — bob (miembro activo no-owner) setea su headline.
  it("happy: caller miembro activo, set headline string → UPDATE acotado", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pid } = await seedScenario(tx);
      await tx.as("authB");
      await tx.q(`SELECT app.update_my_headline($1, $2)`, [pid, "Recién en el barrio"]);
      expect(await readHeadline(tx, uB, pid)).toBe("Recién en el barrio");
    });
  });

  // T2: set NULL post-set — limpia el slot. Defense contra DEFAULT NULL al
  // crear vs explicit NULL post-edit; ambos paths deben dejar la columna en NULL.
  it("set NULL post-set: vuelve a NULL", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pid } = await seedScenario(tx);
      await tx.as("authB");
      await tx.q(`SELECT app.update_my_headline($1, $2)`, [pid, "valor temporal"]);
      expect(await readHeadline(tx, uB, pid)).toBe("valor temporal");
      await tx.q(`SELECT app.update_my_headline($1, $2)`, [pid, null]);
      expect(await readHeadline(tx, uB, pid)).toBeNull();
    });
  });

  // T3: caller sin sesión (claim vacío) → 28000. Misma superficie estándar PG
  // que el resto de las DEFINER (no P0001).
  it("denial: caller sin sesión → 28000 invalid_authorization_specification", async () => {
    await inRlsTx(async (tx) => {
      const { pid } = await seedScenario(tx);
      await tx.as(null);
      const err = await captureError(tx, `SELECT app.update_my_headline($1, $2)`, [pid, "x"]);
      expect(err.code).toBe("28000");
    });
  });

  // T4: caller no-miembro (dave sin membership en place) → P0001 'caller is
  // not an active member of this place'. Misma pre-condition que T5 (left_at
  // NOT NULL) pero distinto path (sin fila vs fila cerrada).
  it("denial: caller no-miembro → P0001 'caller is not an active member of this place'", async () => {
    await inRlsTx(async (tx) => {
      const { pid } = await seedScenario(tx);
      await tx.as("authD"); // dave: NO membership en place
      const err = await captureError(tx, `SELECT app.update_my_headline($1, $2)`, [pid, "x"]);
      expect(err.code).toBe("P0001");
      expect((err.message ?? "").toLowerCase()).toContain("not an active member");
    });
  });

  // T5: caller con membership left_at NOT NULL (eve = ex-miembro) → mismo
  // error path que T4. Cubre el caso edge de membership cerrada.
  it("denial: caller con membership left_at NOT NULL (ex-miembro) → 'not an active member'", async () => {
    await inRlsTx(async (tx) => {
      const { pid } = await seedScenario(tx);
      await tx.as("authE"); // eve: left_at NOT NULL
      const err = await captureError(tx, `SELECT app.update_my_headline($1, $2)`, [pid, "x"]);
      expect(err.code).toBe("P0001");
      expect((err.message ?? "").toLowerCase()).toContain("not an active member");
    });
  });

  // T6: owner edita su propio headline (alice = founder + owner ES también
  // miembro activo). Path happy idéntico a T1 — la función no discrimina por
  // rol caller, sólo por "active member". Owner-as-member es path normal.
  it("happy: owner edita su propio headline (alice founder+owner)", async () => {
    await inRlsTx(async (tx) => {
      const { uA, pid } = await seedScenario(tx);
      await tx.as("authA");
      await tx.q(`SELECT app.update_my_headline($1, $2)`, [pid, "Fundadora del lugar"]);
      expect(await readHeadline(tx, uA, pid)).toBe("Fundadora del lugar");
    });
  });

  // T7: la función NO tiene path para editar headline de otro. El cuerpo
  // siempre acota WHERE user_id = caller. Caller alice (owner) intenta editar
  // headline de bob: la función SETea el de alice (acotada al caller), NO el
  // de bob. Esto fija el contract: NO existe `p_target_user_id` — el owner
  // no tiene path desde la DEFINER para tocar headlines ajenos. Defensa
  // contra una API futura que agregue ese arg por accidente.
  it("contract: caller=owner alice → UPDATE acota WHERE user_id=alice (bob.headline intacto)", async () => {
    await inRlsTx(async (tx) => {
      const { uA, uB, pid } = await seedScenario(tx);
      // Pre-state: bob.headline = NULL inicial.
      expect(await readHeadline(tx, uB, pid)).toBeNull();
      await tx.as("authA");
      await tx.q(`SELECT app.update_my_headline($1, $2)`, [pid, "alice headline"]);
      // alice's headline updated, bob's untouched.
      expect(await readHeadline(tx, uA, pid)).toBe("alice headline");
      expect(await readHeadline(tx, uB, pid)).toBeNull();
    });
  });

  // T8: headline > 280 chars vía DEFINER → 23514 check_violation. La función
  // NO re-valida length; delega al CHECK constraint (defense-in-depth). zod
  // app-side rechaza antes en runtime, pero si alguien skip-ea zod (testing,
  // bug app-side), el DB constraint preserva el invariante.
  it("defense-in-depth: headline 281 chars vía DEFINER → 23514 check_violation", async () => {
    await inRlsTx(async (tx) => {
      const { pid } = await seedScenario(tx);
      await tx.as("authB"); // bob = miembro activo
      const tooLong = "x".repeat(281);
      const err = await captureError(tx, `SELECT app.update_my_headline($1, $2)`, [pid, tooLong]);
      expect(err.code).toBe("23514");
    });
  });
});
