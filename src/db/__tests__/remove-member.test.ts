import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";
import {
  captureError,
  makeMembership,
  makePlace,
  makeUser,
} from "./_factories";

// Feature E · S4 (spec §CU4, 2026-05-24) — 3er mutador DEFINER del slice
// members. Soft-remove de miembro vía UPDATE `membership.left_at = now()`
// (preserva la fila + historial joined_at + el UNIQUE(user_id, place_id)
// sigue activo bloqueando re-join V1).
//
// `app.remove_member(p_target_user_id text, p_place_id text) RETURNS void`
// SECURITY DEFINER LANGUAGE plpgsql.
//
// Pre-conditions in body (6) en orden tal que el primer fail relevante manda
// (defense-in-depth + diagnóstico claro + anti-info-leak):
//   1. caller autenticado (28000).
//   2. app_user existe para el caller (P0002) — necesario para self-check (4).
//   3. caller is owner del place vía `app.current_user_owns_place` (P0001
//      'caller is not an owner of this place'). Captura uniformemente
//      cross-place + place inexistente + member-no-owner.
//   4. target NO es el caller (no self-remove V1) → P0001 'cannot self-remove;
//      use leave_place (V1.1+)'. Evaluado ANTES de target-is-owner para que
//      caller=target=founder+owner (T6) caiga acá con mensaje específico
//      (en lugar del genérico 'target is owner'). V1.1+ tendrá leave_place
//      con design separado para no-owners que se sale por su cuenta.
//   5. target NO es owner del place → P0001 'target is an owner; revoke
//      ownership first'. Post-ADR-0054 (single-owner, migration 0029) esta
//      pre-condition es defense-in-depth UNREACHABLE por el path canónico:
//      con UNIQUE place_ownership(place_id), "caller es owner Y target es
//      owner del mismo place" implica caller = target, que ya cayó en la
//      self-check (4). El check queda en el cuerpo como guard estructural
//      (su antiguo test multi-owner se eliminó con `app.revoke_ownership`).
//   6. target es miembro activo (membership existe AND left_at IS NULL) →
//      P0001 'target is not an active member'. Captura uniformemente target
//      sin membership en place (T7) + target ya-removido con left_at NOT NULL
//      (T8) con MISMO message — evita info-leak sobre historial pasado.
//
// Body: UPDATE membership SET left_at = now() WHERE place_id AND user_id AND
// left_at IS NULL. Soft-remove (NO DELETE físico) — preserva FKs de contenido
// del ex-miembro (ontologia §"Cuatro — Derecho al olvido estructurado").
//
// Patrón seed-as-owner / assert-as-`app_system` heredado de
// `revoke-invitation.test.ts` (precedent S3). Factories de `_factories/`
// (Phase 1.C). ROLLBACK siempre.

afterAll(() => endRlsAdminPool());

// Escenario canónico S4 (single-owner post-ADR-0054, migration 0029):
//   - place-a: alice founder+owner única; bob/carol miembros activos
//     no-owner, dave ex-miembro (left_at NOT NULL).
//   - place-b: carol founder+owner (isolation cross-place — el target
//     existirá en place-b mientras caller intenta operar sobre place-b
//     sin ser owner allí).
//   - eve: app_user existe pero SIN membership en ningún place (T7).
async function seedScenario(tx: RlsTx) {
  const alice = await makeUser(tx, { authUserId: "authA" });
  const bob = await makeUser(tx, { authUserId: "authB" });
  const carol = await makeUser(tx, { authUserId: "authC" });
  const dave = await makeUser(tx, { authUserId: "authD" });
  const eve = await makeUser(tx, { authUserId: "authE" });
  const placeA = await makePlace(tx, { slug: "place-a", name: "Place A", founderUserId: alice.userId });
  const placeB = await makePlace(tx, { slug: "place-b", name: "Place B", founderUserId: carol.userId });
  // Memberships en place-a: alice/bob/carol activos.
  await makeMembership(tx, { userId: alice.userId, placeId: placeA.placeId });
  await makeMembership(tx, { userId: bob.userId, placeId: placeA.placeId });
  await makeMembership(tx, { userId: carol.userId, placeId: placeA.placeId });
  // Dave ex-miembro de place-a (left_at NOT NULL — ya removido históricamente).
  await makeMembership(tx, { userId: dave.userId, placeId: placeA.placeId, leftAt: new Date() });
  // place-b: carol miembro activo + founder.
  await makeMembership(tx, { userId: carol.userId, placeId: placeB.placeId });
  return {
    uA: alice.userId,
    uB: bob.userId,
    uC: carol.userId,
    uD: dave.userId,
    uE: eve.userId,
    pidA: placeA.placeId,
    pidB: placeB.placeId,
  };
}

describe("S4 app.remove_member — DEFINER soft-remove (spec §CU4)", () => {
  // T1: happy — alice (founder+owner) remueve carol (miembro no-owner).
  // UPDATE soft-remove: left_at = now() NOT NULL. Row preservada (no DELETE).
  // Sanity: las otras 2 memberships activas (alice/bob) intactas; dave
  // (left_at históricamente NOT NULL) sin cambios.
  it("happy: caller owner founder → UPDATE membership.left_at = now()", async () => {
    await inRlsTx(async (tx) => {
      const { uA, uB, uC, uD, pidA } = await seedScenario(tx);
      await tx.as("authA");
      await tx.q(`SELECT app.remove_member($1, $2)`, [uC, pidA]);
      const carolRow = (await tx.seed(
        `SELECT id, left_at FROM membership WHERE user_id = $1 AND place_id = $2`,
        [uC, pidA],
      )) as Array<{ id: string; left_at: Date | null }>;
      expect(carolRow).toHaveLength(1); // row preservada (no DELETE)
      expect(carolRow[0]!.left_at).not.toBeNull(); // soft-remove
      // Sanity: alice/bob siguen activos (no nuke accidental).
      const stillActive = (await tx.seed(
        `SELECT user_id FROM membership WHERE place_id = $1 AND left_at IS NULL`,
        [pidA],
      )) as Array<{ user_id: string }>;
      expect(stillActive.map((r) => r.user_id).sort()).toEqual([uA, uB].sort());
      // Sanity: dave sigue históricamente removido (no re-tocado).
      const daveRow = (await tx.seed(
        `SELECT left_at FROM membership WHERE user_id = $1 AND place_id = $2`,
        [uD, pidA],
      )) as Array<{ left_at: Date | null }>;
      expect(daveRow[0]!.left_at).not.toBeNull();
    });
  });

  // T2: caller sin sesión (claim vacío) → 28000.
  it("denial: caller sin sesión → 28000 invalid_authorization_specification", async () => {
    await inRlsTx(async (tx) => {
      const { uC, pidA } = await seedScenario(tx);
      await tx.as(null);
      const err = await captureError(tx, `SELECT app.remove_member($1, $2)`, [uC, pidA]);
      expect(err.code).toBe("28000");
    });
  });

  // T3: caller no-owner — carol (miembro activo de place-a pero NO owner)
  // intenta remover a bob → P0001 'caller is not an owner of this place'.
  it("denial: caller miembro no-owner → P0001 'caller is not an owner of this place'", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pidA } = await seedScenario(tx);
      await tx.as("authC"); // carol no-owner de place-a
      const err = await captureError(tx, `SELECT app.remove_member($1, $2)`, [uB, pidA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/caller is not an owner/i);
    });
  });

  // (Los viejos T4/T5 "target es co-owner/founder" se eliminaron con
  // ADR-0054: sin co-owners no existe el escenario caller-owner ≠
  // target-owner; el caso caller=target=owner único lo cubre T6 vía la
  // self-check, que corre ANTES del guard 'target is an owner'.)

  // T6: self-remove — caller=alice, target=alice → P0001 'cannot self-remove;
  // use leave_place (V1.1+)'. La self-check viene ANTES de target-is-owner
  // (pre-condition 4 antes de 5) para que el caso patológico
  // caller=target=founder+owner caiga acá con mensaje específico (no genérico
  // 'target is owner'). V1 no permite self-remove sin design dedicado;
  // V1.1+ tendrá `app.leave_place` para no-owners.
  it("denial: self-remove → P0001 'cannot self-remove; use leave_place (V1.1+)'", async () => {
    await inRlsTx(async (tx) => {
      const { uA, pidA } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(tx, `SELECT app.remove_member($1, $2)`, [uA, pidA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/cannot self-remove/i);
      expect(err.message).toMatch(/leave_place/i);
    });
  });

  // T7: target no-miembro — eve (app_user existe pero sin membership en
  // ningún place) → P0001 'target is not an active member'. Captura
  // uniformemente con T8 (no leak-ear historial de membership pasada).
  it("denial: target sin membership → P0001 'target is not an active member'", async () => {
    await inRlsTx(async (tx) => {
      const { uE, pidA } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(tx, `SELECT app.remove_member($1, $2)`, [uE, pidA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/target is not an active member/i);
    });
  });

  // T8: target ya removido — dave (membership con left_at NOT NULL,
  // históricamente removido) → P0001 'target is not an active member'
  // (mismo error que T7 — captura uniforme de "no es miembro activo" sin
  // leak-ear si fue miembro alguna vez).
  it("denial: target ya removido (left_at NOT NULL) → P0001 'not an active member'", async () => {
    await inRlsTx(async (tx) => {
      const { uD, pidA } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(tx, `SELECT app.remove_member($1, $2)`, [uD, pidA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/target is not an active member/i);
    });
  });

  // (El viejo T9 "multi-owner: co-owner remueve" se eliminó con ADR-0054 —
  // no existen co-owners; el gate owner-of-place queda cubierto por T1/T3.)

  // T10: cross-place denied — alice (owner de place-a, NO de place-b)
  // intenta remover a carol (miembro activo de place-b donde alice no es
  // owner) → P0001 'caller is not an owner of this place'. El gate de
  // ownership se aplica al place del target (p_place_id), no al place del
  // caller — captura aislación entre places.
  it("denial: cross-place — owner de otro place intenta remove → P0001 'not an owner'", async () => {
    await inRlsTx(async (tx) => {
      const { uC, pidB } = await seedScenario(tx);
      await tx.as("authA"); // alice = owner de place-a, NO de place-b
      const err = await captureError(tx, `SELECT app.remove_member($1, $2)`, [uC, pidB]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/caller is not an owner/i);
    });
  });
});
