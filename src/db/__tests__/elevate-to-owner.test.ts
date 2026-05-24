import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";

// Feature D · S2 (ADR-0035 §Decisión 2 CU2, 2026-05-24) — primer mutador
// DEFINER post-refactor S1. Canaliza la única vía de promover un miembro
// activo a co-owner del place (INSERT directo en `place_ownership` queda
// REVOKE por S1 — toda mutación pasa por las 4 funciones DEFINER).
//
// `app.elevate_to_owner(p_to_user_id text, p_place_id text) RETURNS void`
// SECURITY DEFINER LANGUAGE plpgsql. Pre-conditions in body (5):
//   1. caller autenticado (28000 si claim vacío)                — T6
//   2. place exists (P0001 'place not found')                   — T7
//   3. caller is owner of place (P0001 'caller is not an owner') — T2
//   4. target NOT already owner (P0001 'target is already an owner') — T4/T5
//   5. target IS active member, left_at IS NULL (P0001 'target is not an
//      active member')                                          — T3/T8
//
// Patrón seed-as-owner / assert-as-`app_system` heredado de
// `rls-place-ownership.test.ts` (S1) y `consume-sso-jti.test.ts` (Feature C
// S1). ROLLBACK siempre.

afterAll(() => endRlsAdminPool());

const APP_USER = `INSERT INTO app_user (auth_user_id,email,display_name,handle)
                  VALUES ($1,$2,'X',$3) RETURNING id`;
// Post-0012: `place.founder_user_id` es NOT NULL.
const PLACE = `INSERT INTO place (slug,name,billing_mode,founder_user_id)
               VALUES ($1,$2,'OWNER_PAYS',$3) RETURNING id`;

// Escenario canónico S2: place-a (alice founder+owner) + place-b (carol
// founder+owner). Memberships en place-a: alice/bob/carol activos, eve con
// left_at = now() (ex-miembro), dave SIN membership. Cubre los 8 tests
// mapping 1:1 con `tests.md` §S2.
async function seedScenario(tx: RlsTx) {
  const [{ id: uA }] = (await tx.seed(APP_USER, ["authA", "a@x.com", "h_a"])) as Array<{ id: string }>;
  const [{ id: uB }] = (await tx.seed(APP_USER, ["authB", "b@x.com", "h_b"])) as Array<{ id: string }>;
  const [{ id: uC }] = (await tx.seed(APP_USER, ["authC", "c@x.com", "h_c"])) as Array<{ id: string }>;
  const [{ id: uD }] = (await tx.seed(APP_USER, ["authD", "d@x.com", "h_d"])) as Array<{ id: string }>;
  const [{ id: uE }] = (await tx.seed(APP_USER, ["authE", "e@x.com", "h_e"])) as Array<{ id: string }>;
  const [{ id: pidA }] = (await tx.seed(PLACE, ["place-a", "Place A", uA])) as Array<{ id: string }>;
  const [{ id: pidB }] = (await tx.seed(PLACE, ["place-b", "Place B", uC])) as Array<{ id: string }>;
  // alice founder+owner de place-a; carol founder+owner de place-b (isolation
  // cross-place). En place-a, carol es sólo miembro (test T2 caller no-owner).
  await tx.seed(`INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`, [uA, pidA]);
  await tx.seed(`INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`, [uC, pidB]);
  // Memberships en place-a: alice/bob/carol activos; eve left_at NOT NULL.
  // dave intencionalmente sin fila → T3 (target sin membership).
  await tx.seed(
    `INSERT INTO membership (user_id,place_id,left_at) VALUES
     ($1,$2,NULL),
     ($3,$2,NULL),
     ($4,$2,NULL),
     ($5,$2, now())`,
    [uA, pidA, uB, uC, uE],
  );
  return { uA, uB, uC, uD, uE, pidA, pidB };
}

// Captura el error de una query bajo SAVEPOINT (un stmt fallido aborta la tx
// en Postgres; el savepoint preserva el resto). Retorna code+message o
// {null,null} si la query no falló. Usa `tx.q` para no acceder al cliente
// crudo — los SAVEPOINT/ROLLBACK son DML normal que el rol app_system puede
// ejecutar dentro de una tx en curso.
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

const countOwnerships = async (tx: RlsTx, pid: string) =>
  ((await tx.q(`SELECT count(*)::int n FROM place_ownership WHERE place_id=$1`, [pid])) as Array<{ n: number }>)[0].n;

describe("S2 app.elevate_to_owner — DEFINER mutator CU2 (ADR-0035 §Decisión 2)", () => {
  // T1: path happy — alice owner promueve bob (miembro activo, no-owner).
  // Post-call: 2 owners en place-a (alice founder + bob co-owner).
  it("happy: caller owner + target active member + not-owner → INSERT ownership row", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pidA } = await seedScenario(tx);
      await tx.as("authA");
      await tx.q(`SELECT app.elevate_to_owner($1, $2)`, [uB, pidA]);
      expect(await countOwnerships(tx, pidA)).toBe(2);
      // Defense-in-depth: la fila concreta de bob existe (vía seed bypass RLS).
      const rows = (await tx.seed(
        `SELECT user_id FROM place_ownership WHERE place_id=$1 AND user_id=$2`,
        [pidA, uB],
      )) as Array<{ user_id: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(uB);
    });
  });

  // T2: privilege escalation block — carol (miembro de place-a, no owner) NO
  // puede promover a nadie. Caller ownership es la barrera primaria explícita
  // (después de auth + place exists). Bug acá = privilege escalation crítica.
  it("denial: caller no-owner del place → P0001 'caller is not an owner of this place'", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pidA } = await seedScenario(tx);
      await tx.as("authC"); // carol es miembro de place-a pero owner de place-b
      const err = await captureError(tx, `SELECT app.elevate_to_owner($1, $2)`, [uB, pidA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/caller is not an owner/i);
      // Defense-in-depth: count owners de place-a sigue 1 (sin side-effect).
      // `tx.seed` (admin bypass) en vez de `countOwnerships` (`tx.q` con claim
      // de carol) porque la nueva `po_sel` via helper filtra todas las filas
      // bajo claim no-owner → carol verá 0; queremos la cuenta real del schema.
      const rowsSeed = (await tx.seed(
        `SELECT count(*)::int n FROM place_ownership WHERE place_id=$1`,
        [pidA],
      )) as Array<{ n: number }>;
      expect(rowsSeed[0].n).toBe(1);
    });
  });

  // T3: target dave NO tiene membership en place-a → rechazado por la pre-
  // condition de active member. Nunca se llega al INSERT.
  it("denial: target sin membership → P0001 'target is not an active member'", async () => {
    await inRlsTx(async (tx) => {
      const { uD, pidA } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(tx, `SELECT app.elevate_to_owner($1, $2)`, [uD, pidA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/target is not an active member/i);
      expect(await countOwnerships(tx, pidA)).toBe(1);
    });
  });

  // T4: target ya es owner del place → duplicate bloqueado. La pre-condition
  // "already owner" se chequea ANTES de "active member" para que el caso
  // self-promote (target=caller, T5) caiga acá sin path especial.
  it("denial: target ya owner → P0001 'target is already an owner'", async () => {
    await inRlsTx(async (tx) => {
      const { uA, pidA } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(tx, `SELECT app.elevate_to_owner($1, $2)`, [uA, pidA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/target is already an owner/i);
    });
  });

  // T5: self-promote (caller=target=alice) → tratado idéntico a T4. Fija el
  // contract: la función NO trata self-as-target como caso especial; la pre-
  // condition "already owner" lo cubre por ser alice ya owner por construcción.
  // Test redundante con T4 pero documenta explícitamente el contrato.
  it("denial: caller = target (self-promote) → mismo error 'already an owner' (no special-case)", async () => {
    await inRlsTx(async (tx) => {
      const { uA, pidA } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(tx, `SELECT app.elevate_to_owner($1, $2)`, [uA, pidA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/target is already an owner/i);
    });
  });

  // T6: caller anónimo (claim vacío). 28000 es la única superficie estándar
  // PG (no P0001): wrapper TS V1.1 lo mapea a UnauthorizedError sin depender
  // del message. Mismo path que `app.create_place` (ADR-0012 §3) y precedentes.
  it("denial: caller sin sesión (claim vacío) → 28000 invalid_authorization_specification", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pidA } = await seedScenario(tx);
      await tx.as(null);
      const err = await captureError(tx, `SELECT app.elevate_to_owner($1, $2)`, [uB, pidA]);
      expect(err.code).toBe("28000");
    });
  });

  // T7: place_id que no existe → rechazado por pre-condition "place exists"
  // ANTES de evaluar caller ownership (evita filtrar por error la existencia
  // del place vía un message ambiguo "caller is not an owner" sobre un id que
  // ni existe).
  it("denial: place inexistente → P0001 'place not found'", async () => {
    await inRlsTx(async (tx) => {
      const { uB } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(tx, `SELECT app.elevate_to_owner($1, $2)`, [uB, "nonexistent_id"]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/place not found/i);
    });
  });

  // T8: target con membership pero `left_at NOT NULL` → ex-miembro. Misma
  // pre-condition que T3 pero distinto path (existe la fila pero está cerrada).
  // Defensa contra UI que muestre ex-miembros como elegibles para promote.
  it("denial: target con membership left_at NOT NULL (ex-miembro) → 'not active member'", async () => {
    await inRlsTx(async (tx) => {
      const { uE, pidA } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(tx, `SELECT app.elevate_to_owner($1, $2)`, [uE, pidA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/target is not an active member/i);
    });
  });
});
