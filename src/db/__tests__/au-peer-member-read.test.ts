import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";

// Feature E · S6 (ADR-0038, 2026-05-25) — tests estructurales de la nueva
// policy `au_peer_member_read` sobre `app_user` (migration 0021) + del
// helper SECURITY DEFINER `app.is_peer_member(text)`.
//
// Cubre las 6 reglas de lectura post-ADR-0038 (ver migration header):
//   T1: caller en place P lee app_user de otro miembro de P (happy peer-read).
//   T2: caller en place A NO lee app_user de user de place B (isolation).
//   T3: caller NO lee app_user de ex-miembro (left_at NOT NULL).
//   T4: caller sin membership en ningún place sólo lee su propia fila.
//   T5: owner sigue leyendo app_user de todos los miembros activos del place
//       (por invariante ADR-0035 §2 — owners son siempre miembros).
//   T6: au_self sigue gating INSERT/UPDATE/DELETE self-only (la nueva
//       policy FOR SELECT no afecta mutations).
//
// Harness: `inRlsTx` (seed-as-owner, assert-as-`app_system` con claim
// inyectado, ROLLBACK siempre). Misma estructura que rls.test.ts +
// rls-place-ownership.test.ts (precedentes Features A y D).

afterAll(() => endRlsAdminPool());

const APP_USER = `INSERT INTO app_user (auth_user_id,email,display_name,handle)
                  VALUES ($1,$2,$3,$4) RETURNING id`;
const PLACE = `INSERT INTO place (slug,name,billing_mode,founder_user_id)
               VALUES ($1,$2,'OWNER_PAYS',$3) RETURNING id`;

// Escenario canónico:
//   - place-a: alice founder+owner, bob co-owner, carol miembro activo
//     no-owner, dave ex-miembro (left_at NOT NULL).
//   - place-b: erin founder+owner; sin overlap con place-a.
//   - frank: app_user con email/handle pero SIN membership en ningún place
//     (caller "outsider" — sólo se lee a sí mismo).
async function seedScenario(tx: RlsTx) {
  const [{ id: uA }] = (await tx.seed(APP_USER, [
    "authA",
    "a@x.com",
    "Alice",
    "alice",
  ])) as Array<{ id: string }>;
  const [{ id: uB }] = (await tx.seed(APP_USER, [
    "authB",
    "b@x.com",
    "Bob",
    "bob",
  ])) as Array<{ id: string }>;
  const [{ id: uC }] = (await tx.seed(APP_USER, [
    "authC",
    "c@x.com",
    "Carol",
    "carol",
  ])) as Array<{ id: string }>;
  const [{ id: uD }] = (await tx.seed(APP_USER, [
    "authD",
    "d@x.com",
    "Dave",
    "dave",
  ])) as Array<{ id: string }>;
  const [{ id: uE }] = (await tx.seed(APP_USER, [
    "authE",
    "e@x.com",
    "Erin",
    "erin",
  ])) as Array<{ id: string }>;
  const [{ id: uF }] = (await tx.seed(APP_USER, [
    "authF",
    "f@x.com",
    "Frank",
    "frank",
  ])) as Array<{ id: string }>;
  const [{ id: pidA }] = (await tx.seed(PLACE, [
    "place-a",
    "Place A",
    uA,
  ])) as Array<{ id: string }>;
  const [{ id: pidB }] = (await tx.seed(PLACE, [
    "place-b",
    "Place B",
    uE,
  ])) as Array<{ id: string }>;
  // place-a: alice founder+owner, bob co-owner.
  await tx.seed(
    `INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2),($3,$2)`,
    [uA, pidA, uB],
  );
  // place-b: erin founder+owner.
  await tx.seed(`INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`, [
    uE,
    pidB,
  ]);
  // Memberships activas: alice, bob, carol en place-a; erin en place-b.
  await tx.seed(
    `INSERT INTO membership (user_id,place_id) VALUES ($1,$2),($3,$2),($4,$2)`,
    [uA, pidA, uB, uC],
  );
  await tx.seed(`INSERT INTO membership (user_id,place_id) VALUES ($1,$2)`, [
    uE,
    pidB,
  ]);
  // Dave ex-miembro de place-a (left_at NOT NULL — históricamente removido).
  await tx.seed(
    `INSERT INTO membership (user_id,place_id,left_at) VALUES ($1,$2,now())`,
    [uD, pidA],
  );
  return { uA, uB, uC, uD, uE, uF, pidA, pidB };
}

describe("au_peer_member_read — policy SELECT-only peer-read sobre app_user (ADR-0038)", () => {
  // T1: happy peer-read — carol (miembro no-owner de place-a) lee app_user
  // de bob (co-owner de place-a, otro miembro activo del mismo place).
  // Comparten place-a → app.is_peer_member(bob.id) = true → SELECT pasa.
  it("T1 peer-read: caller miembro lee app_user de otro miembro activo del mismo place", async () => {
    await inRlsTx(async (tx) => {
      const { uB } = await seedScenario(tx);
      await tx.as("authC"); // carol miembro no-owner de place-a
      const rows = (await tx.q(
        `SELECT id, display_name, handle FROM app_user WHERE id = $1`,
        [uB],
      )) as Array<{ id: string; display_name: string; handle: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.display_name).toBe("Bob");
      expect(rows[0]!.handle).toBe("bob");
    });
  });

  // T2: isolation cross-place — erin (founder+owner+miembro de place-b,
  // sin overlap con place-a) intenta leer app_user de bob (sólo en
  // place-a, no en place-b). Sin place compartido → app.is_peer_member
  // = false → SELECT filtra → 0 rows.
  it("T2 isolation: caller en place B NO lee app_user de user de place A sin overlap", async () => {
    await inRlsTx(async (tx) => {
      const { uB } = await seedScenario(tx);
      await tx.as("authE"); // erin sólo en place-b
      const rows = (await tx.q(`SELECT id FROM app_user WHERE id = $1`, [uB]));
      expect(rows).toHaveLength(0);
    });
  });

  // T3: ex-miembro filter — alice (owner+miembro activo de place-a)
  // intenta leer app_user de dave (ex-miembro con left_at NOT NULL).
  // `other_m.left_at IS NULL` del helper filtra → app.is_peer_member
  // = false → SELECT filtra. Importante anti-info-leak: alice no puede
  // ver datos personales de ex-miembros que ya salieron del place.
  it("T3 ex-miembro: caller NO lee app_user de ex-miembro (left_at NOT NULL)", async () => {
    await inRlsTx(async (tx) => {
      const { uD } = await seedScenario(tx);
      await tx.as("authA"); // alice founder+owner
      const rows = (await tx.q(`SELECT id FROM app_user WHERE id = $1`, [uD]));
      expect(rows).toHaveLength(0);
    });
  });

  // T4: outsider — frank (sin membership en ningún place) lee app_user.
  // Sólo `au_self` pasa para su propia fila; `au_peer_member_read` no
  // matchea ninguna otra (sin lugar común). Resultado: ve sólo a sí mismo
  // de un SELECT que pide alice + frank.
  it("T4 outsider: caller sin membership lee SÓLO su propia fila", async () => {
    await inRlsTx(async (tx) => {
      const { uA, uF } = await seedScenario(tx);
      await tx.as("authF"); // frank sin membership
      const rows = (await tx.q(
        `SELECT id FROM app_user WHERE id IN ($1, $2)`,
        [uA, uF],
      )) as Array<{ id: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(uF);
    });
  });

  // T5: owner peer-read — alice (founder+owner+miembro de place-a) lee
  // app_user de carol (miembro no-owner del mismo place). Por invariante
  // ADR-0035 §2 los owners son siempre miembros → la regla del peer-read
  // los cubre naturalmente. Sanity de "owner ve a todos los miembros".
  it("T5 owner: founder lee app_user de cualquier miembro activo de su place", async () => {
    await inRlsTx(async (tx) => {
      const { uC } = await seedScenario(tx);
      await tx.as("authA"); // alice founder+owner
      const rows = (await tx.q(
        `SELECT id, display_name FROM app_user WHERE id = $1`,
        [uC],
      )) as Array<{ id: string; display_name: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.display_name).toBe("Carol");
    });
  });

  // T6: mutación owner-only mantenida — carol (peer de bob) puede
  // SELECT-ear bob via au_peer_member_read, pero NO puede UPDATE-ear
  // bob's display_name. La policy au_peer_member_read es FOR SELECT;
  // au_self es FOR ALL y exige `current_user_id() = authUserId`. Bob no
  // es carol → au_self deniega → UPDATE rechazado (0 rows affected, sin
  // exception por PG comportamiento default de UPDATE con RLS).
  it("T6 mutación: caller peer NO puede UPDATE app_user de otro (au_self sigue gating)", async () => {
    await inRlsTx(async (tx) => {
      const { uB } = await seedScenario(tx);
      await tx.as("authC"); // carol peer de bob
      const result = await tx.q(
        `UPDATE app_user SET display_name = 'HACKED' WHERE id = $1 RETURNING id`,
        [uB],
      );
      expect(result).toHaveLength(0); // au_self filtra el UPDATE — bob no es carol
      // Confirm bob.display_name intacto (re-leído como seed, RLS no aplica)
      const bobNow = (await tx.seed(
        `SELECT display_name FROM app_user WHERE id = $1`,
        [uB],
      )) as Array<{ display_name: string }>;
      expect(bobNow[0]!.display_name).toBe("Bob");
    });
  });
});
