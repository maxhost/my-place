import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";
import {
  captureError,
  makeInvitation,
  makeMembership,
  makeOwnership,
  makePlace,
  makeUser,
} from "./_factories";

// Feature E · S3 (ADR-0010 §2 + spec §CU3, 2026-05-24) — 2do mutador DEFINER
// del flow invitations. Cancela una invitation pending: DELETE físico (la
// capability deja de existir; el token queda inválido inmediatamente). NO
// soft-delete (no hay columna `revoked_at`); el contract es "esta capability
// no existe más". Complementa `app.create_invitation` (S2).
//
// `app.revoke_invitation(p_invitation_id text) RETURNS void` SECURITY DEFINER
// LANGUAGE plpgsql.
//
// Pre-conditions in body (4) en orden tal que el primer fail relevante manda:
//   1. caller autenticado (28000).
//   2. invitation existe → lookup `(place_id, accepted_at)`. P0001
//      'invitation not found' si no existe. NO se considera anti-info-leak
//      (invitation IDs son UUIDs 2^122 — enumeración infeasible; un error
//      claro acá ayuda al wrapper TS a discriminar UI casos).
//   3. caller is owner del place de la invitation, vía
//      `app.current_user_owns_place(v_place_id)`. P0001 'caller is not an
//      owner of this place'. Captura uniformemente cross-place +
//      member-no-owner (anti-info-leak: no diferenciar entre "no soy owner"
//      y "no soy owner de ESE place").
//   4. invitation NO ya aceptada → si `accepted_at IS NOT NULL`: P0001
//      'cannot revoke already-accepted invitation'. Una invitation aceptada
//      ya consumió su capability (creó membership); revocarla acá dejaría
//      `membership` huérfana. El path correcto post-aceptación es
//      `app.remove_member` (S4).
//
// Body: DELETE FROM invitation WHERE id = p_invitation_id. Físico (capability
// ceases to exist + token immediately invalid). Sin UPDATE soft-delete.
//
// Notas de diseño:
// - Expired pending revoke es OK (T8): si `expires_at < now()` AND
//   `accepted_at IS NULL`, la invitation está "consumida por timeout" pero
//   sigue siendo cancellable para limpieza explícita (el owner que quiere
//   limpiar UI sin esperar al GC eventual). El contract NO discrimina entre
//   pending fresh y pending expired — ambos son revocables.
// - Sin P0002 lookup de app_user: no escribimos v_caller en ninguna fila
//   (es DELETE puro). El gate de ownership ya valida la sesión vía
//   `current_user_owns_place` que internamente lee el claim.
//
// Patrón seed-as-owner / assert-as-`app_system` heredado de
// `create-invitation.test.ts` (precedent S2). Factories de `_factories/`
// (Phase 1.C). ROLLBACK siempre.

afterAll(() => endRlsAdminPool());

// Escenario canónico S3:
//   - place-a: alice founder+owner, bob co-owner, carol miembro no-owner.
//   - place-b: carol founder+owner (isolation cross-place).
//   - 3 invitations en place-a + 1 invitation en place-b:
//       invPendingA: place-a, pending (expires_at fresh, accepted_at NULL).
//       invAcceptedA: place-a, accepted_at = now() (ya consumió capability).
//       invExpiredA: place-a, expires_at < now() AND accepted_at NULL.
//       invPendingB: place-b, pending (para cross-place test).
async function seedScenario(tx: RlsTx) {
  const alice = await makeUser(tx, { authUserId: "authA" });
  const bob = await makeUser(tx, { authUserId: "authB" });
  const carol = await makeUser(tx, { authUserId: "authC" });
  const placeA = await makePlace(tx, { slug: "place-a", name: "Place A", founderUserId: alice.userId });
  const placeB = await makePlace(tx, { slug: "place-b", name: "Place B", founderUserId: carol.userId });
  await makeOwnership(tx, { userId: bob.userId, placeId: placeA.placeId });
  // Memberships en place-a: alice/bob/carol activos (carol no-owner).
  await makeMembership(tx, { userId: alice.userId, placeId: placeA.placeId });
  await makeMembership(tx, { userId: bob.userId, placeId: placeA.placeId });
  await makeMembership(tx, { userId: carol.userId, placeId: placeA.placeId });
  // 4 invitations: tokens distintos por counter interno de la factory.
  const invPendingA = await makeInvitation(tx, {
    placeId: placeA.placeId,
    email: "pending@test.com",
    invitedByUserId: alice.userId,
  });
  const invAcceptedA = await makeInvitation(tx, {
    placeId: placeA.placeId,
    email: "accepted@test.com",
    invitedByUserId: alice.userId,
    acceptedAt: new Date(),
  });
  const invExpiredA = await makeInvitation(tx, {
    placeId: placeA.placeId,
    email: "expired@test.com",
    invitedByUserId: alice.userId,
    expiresInDays: -1,
  });
  const invPendingB = await makeInvitation(tx, {
    placeId: placeB.placeId,
    email: "pendingB@test.com",
    invitedByUserId: carol.userId,
  });
  return {
    uA: alice.userId,
    uB: bob.userId,
    uC: carol.userId,
    pidA: placeA.placeId,
    pidB: placeB.placeId,
    invPendingA: invPendingA.invitationId,
    invAcceptedA: invAcceptedA.invitationId,
    invExpiredA: invExpiredA.invitationId,
    invPendingB: invPendingB.invitationId,
  };
}

describe("S3 app.revoke_invitation — DEFINER invitation revoker (ADR-0010 §2 + spec §CU3)", () => {
  // T1: happy path — alice (founder + owner) revoca la invitation pending
  // de place-a. SELECT post-revoke retorna 0 filas con ese id (DELETE físico).
  it("happy: caller owner founder → DELETE invitation; row gone", async () => {
    await inRlsTx(async (tx) => {
      const { pidA, invPendingA } = await seedScenario(tx);
      await tx.as("authA");
      await tx.q(`SELECT app.revoke_invitation($1)`, [invPendingA]);
      const rows = (await tx.seed(
        `SELECT id FROM invitation WHERE id = $1`,
        [invPendingA],
      )) as Array<{ id: string }>;
      expect(rows).toHaveLength(0);
      // Sanity: las otras 2 invitations de place-a siguen ahí (no nuke
      // accidental). Asumimos accepted + expired aún en DB.
      const remaining = (await tx.seed(
        `SELECT id FROM invitation WHERE place_id = $1`,
        [pidA],
      )) as Array<{ id: string }>;
      expect(remaining).toHaveLength(2);
    });
  });

  // T2: caller sin sesión (claim vacío) → 28000.
  it("denial: caller sin sesión → 28000 invalid_authorization_specification", async () => {
    await inRlsTx(async (tx) => {
      const { invPendingA } = await seedScenario(tx);
      await tx.as(null);
      const err = await captureError(tx, `SELECT app.revoke_invitation($1)`, [invPendingA]);
      expect(err.code).toBe("28000");
    });
  });

  // T3: invitation_id inexistente → P0001 'invitation not found'.
  // NO es anti-info-leak: invitation IDs son UUIDs (2^122 posibilidades),
  // enumeración infeasible. Error claro acá ayuda al wrapper TS S7 a
  // discriminar UI casos (e.g., user click revoke en stale UI tras GC).
  it("denial: invitation_id inexistente → P0001 'invitation not found'", async () => {
    await inRlsTx(async (tx) => {
      await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(tx, `SELECT app.revoke_invitation($1)`, [
        "nonexistent_invitation_id",
      ]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/invitation not found/i);
    });
  });

  // T4: caller no-owner del place (carol = miembro pero no owner de place-a)
  // → P0001 'caller is not an owner of this place'. La invitation existe en
  // place-a; carol está en place-a como miembro pero no es owner de place-a.
  it("denial: caller miembro no-owner → P0001 'caller is not an owner of this place'", async () => {
    await inRlsTx(async (tx) => {
      const { invPendingA } = await seedScenario(tx);
      await tx.as("authC"); // carol = miembro no-owner de place-a (owner de place-b)
      const err = await captureError(tx, `SELECT app.revoke_invitation($1)`, [invPendingA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/caller is not an owner/i);
    });
  });

  // T5: already accepted — invitation con accepted_at IS NOT NULL → P0001
  // 'cannot revoke already-accepted invitation'. La capability ya se consumió
  // (creó membership); revocarla acá dejaría drift. Path correcto es
  // remove_member (S4). El check se evalúa DESPUÉS del owner check (el
  // accepted-status sólo importa si el caller tiene autoridad para verlo).
  it("denial: invitation ya aceptada → P0001 'cannot revoke already-accepted invitation'", async () => {
    await inRlsTx(async (tx) => {
      const { invAcceptedA } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(tx, `SELECT app.revoke_invitation($1)`, [invAcceptedA]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/cannot revoke already-accepted/i);
    });
  });

  // T6: multi-owner co-owner — bob (co-owner de place-a, no founder) puede
  // revocar igual que alice. Confirma que el gate es owner-of-place (cualquier
  // owner), no founder-only.
  it("happy multi-owner: caller co-owner (no-founder) → DELETE succeeds", async () => {
    await inRlsTx(async (tx) => {
      const { invPendingA } = await seedScenario(tx);
      await tx.as("authB"); // bob = co-owner de place-a
      await tx.q(`SELECT app.revoke_invitation($1)`, [invPendingA]);
      const rows = (await tx.seed(
        `SELECT id FROM invitation WHERE id = $1`,
        [invPendingA],
      )) as Array<{ id: string }>;
      expect(rows).toHaveLength(0);
    });
  });

  // T7: cross-place denied — alice (owner de place-a) intenta revocar una
  // invitation de place-b (donde alice NO es owner; carol lo es) → P0001
  // 'caller is not an owner of this place'. Captura aislación entre places.
  // El helper `current_user_owns_place(pidB)` retorna false para alice (sin
  // fila en place_ownership con pidB).
  it("denial: cross-place — owner de otro place intenta revoke → P0001 'not an owner'", async () => {
    await inRlsTx(async (tx) => {
      const { invPendingB } = await seedScenario(tx);
      await tx.as("authA"); // alice = owner de place-a, NO de place-b
      const err = await captureError(tx, `SELECT app.revoke_invitation($1)`, [invPendingB]);
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/caller is not an owner/i);
    });
  });

  // T8: expired pending revoke OK — invitation con expires_at < now() AND
  // accepted_at NULL es aún revocable (cleanup explícito; el owner quiere
  // limpiar UI sin esperar GC). El contract NO discrimina entre pending
  // fresh y pending expired — ambos son revocables. Sólo `accepted_at` (T5)
  // bloquea revoke.
  it("happy expired-pending: invitation expired sin accept → DELETE OK (cleanup explícito)", async () => {
    await inRlsTx(async (tx) => {
      const { invExpiredA } = await seedScenario(tx);
      await tx.as("authA");
      await tx.q(`SELECT app.revoke_invitation($1)`, [invExpiredA]);
      const rows = (await tx.seed(
        `SELECT id FROM invitation WHERE id = $1`,
        [invExpiredA],
      )) as Array<{ id: string }>;
      expect(rows).toHaveLength(0);
    });
  });
});
