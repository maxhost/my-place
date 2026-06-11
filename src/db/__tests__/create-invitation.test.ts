import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";
import {
  captureError,
  makeMembership,
  makePlace,
  makeUser,
} from "./_factories";

// Feature E · S2 (ADR-0010 §2 + ADR-0037 §4, 2026-05-24) — primer mutador
// DEFINER del flow invitations. Canaliza el INSERT en `invitation` con gate
// V1 hardcoded owner-only (via `app.current_user_owns_place`, helper de
// Feature D — ADR-0037 §4 documenta que V2+ abrirá el gate a member-with-
// quota-available).
//
// `app.create_invitation(p_place_id text, p_email text, p_expires_at
// timestamptz) RETURNS json` SECURITY DEFINER LANGUAGE plpgsql.
// Pre-conditions in body (4):
//   1. caller autenticado (28000)
//   2. app_user existe para el caller (P0002)
//   3. caller is owner of place via `app.current_user_owns_place(p_place_id)`
//      (P0001 'caller is not an owner of this place'). Captura cross-place,
//      place-not-found y member-no-owner con MISMO message (anti-info-leak
//      sobre existencia del place).
//   4. p_expires_at > now() strict (P0001 'expires_at must be in the future').
// Body: INSERT invitation con token = concatenación de 2 UUIDs (64 hex chars,
// 256 bits entropy, URL-safe). RETURN json {invitation_id, token}. La
// función NO re-valida formato del email — delega a zod app-side.
//
// Patrón seed-as-owner / assert-as-`app_system` (precedente Feature D).
// Factories de `_factories/` (Phase 1.C). ROLLBACK siempre.
//
// Post-ADR-0054 (single-owner, migration 0029): no existen co-owners — el
// escenario es single-owner por place (UNIQUE place_ownership(place_id)).

afterAll(() => endRlsAdminPool());

// Escenario canónico S2: 2 places (alice founder+owner único de place-a;
// carol founder+owner único de place-b). En place-a: alice/bob/carol son
// memberships (bob/carol = miembros no-owner); dave SIN membership en
// place-a.
async function seedScenario(tx: RlsTx) {
  const alice = await makeUser(tx, { authUserId: "authA" });
  const bob = await makeUser(tx, { authUserId: "authB" });
  const carol = await makeUser(tx, { authUserId: "authC" });
  const dave = await makeUser(tx, { authUserId: "authD" });
  const placeA = await makePlace(tx, { slug: "place-a", name: "Place A", founderUserId: alice.userId });
  const placeB = await makePlace(tx, { slug: "place-b", name: "Place B", founderUserId: carol.userId });
  // Memberships en place-a: alice/bob/carol activos. dave no es miembro.
  await makeMembership(tx, { userId: alice.userId, placeId: placeA.placeId });
  await makeMembership(tx, { userId: bob.userId, placeId: placeA.placeId });
  await makeMembership(tx, { userId: carol.userId, placeId: placeA.placeId });
  return {
    uA: alice.userId,
    uB: bob.userId,
    uC: carol.userId,
    uD: dave.userId,
    pidA: placeA.placeId,
    pidB: placeB.placeId,
  };
}

describe("S2 app.create_invitation — DEFINER invitation mutator (ADR-0010 §2 + ADR-0037 §4)", () => {
  // T1: happy path — alice (founder + owner) invita a eve@test.com con
  // expires_at en 7 días. La función retorna {invitation_id, token}; nueva
  // fila `invitation` con accepted_at IS NULL + invited_by = alice.user_id +
  // token coincide con el retorno.
  it("happy: caller owner founder → INSERT invitation + RETURN {invitation_id, token}", async () => {
    await inRlsTx(async (tx) => {
      const { uA, pidA } = await seedScenario(tx);
      await tx.as("authA");
      const rows = (await tx.q(
        `SELECT app.create_invitation($1, $2, now() + interval '7 days') AS j`,
        [pidA, "eve@test.com"],
      )) as Array<{ j: { invitation_id: string; token: string } }>;
      const { invitation_id, token } = rows[0].j;
      expect(invitation_id).toMatch(/[0-9a-f-]+/);
      expect(token).toMatch(/^[0-9a-f]{64}$/); // 2 UUIDs concat, hex-only.
      // Verifica fila vía seed (admin bypass — la RLS owner-only sobre invitation
      // tampoco bloquearía al caller alice pero usamos seed para asserts directos).
      const inv = (await tx.seed(
        `SELECT id, place_id, email, invited_by, accepted_at, token
         FROM invitation WHERE id = $1`,
        [invitation_id],
      )) as Array<{
        id: string;
        place_id: string;
        email: string;
        invited_by: string;
        accepted_at: string | null;
        token: string;
      }>;
      expect(inv).toHaveLength(1);
      expect(inv[0].place_id).toBe(pidA);
      expect(inv[0].email).toBe("eve@test.com");
      expect(inv[0].invited_by).toBe(uA);
      expect(inv[0].accepted_at).toBeNull();
      expect(inv[0].token).toBe(token);
    });
  });

  // T2: caller sin sesión (claim vacío) → 28000. Misma superficie estándar
  // PG que el resto de las DEFINER (independiente del MESSAGE).
  it("denial: caller sin sesión → 28000 invalid_authorization_specification", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as(null);
      const err = await captureError(
        tx,
        `SELECT app.create_invitation($1, $2, now() + interval '7 days')`,
        [pidA, "eve@test.com"],
      );
      expect(err.code).toBe("28000");
    });
  });

  // T3: caller no-owner V1 (carol = miembro pero no owner de place-a) →
  // P0001 'caller is not an owner of this place'. V1 gate hardcoded
  // owner-only (ADR-0037 §4). V2+ abrirá a member-with-quota-available.
  it("denial: caller miembro no-owner V1 → P0001 'caller is not an owner of this place'", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authC"); // carol = miembro no-owner de place-a (owner de place-b)
      const err = await captureError(
        tx,
        `SELECT app.create_invitation($1, $2, now() + interval '7 days')`,
        [pidA, "eve@test.com"],
      );
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/caller is not an owner/i);
    });
  });

  // T4: caller fuera del place (dave sin membership) → mismo P0001 'caller
  // is not an owner of this place'. El helper `current_user_owns_place`
  // captura uniformemente cross-place + no-miembro + member-not-owner.
  it("denial: caller fuera del place (sin membership) → mismo P0001 'not an owner'", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authD"); // dave: sin membership ni ownership en place-a
      const err = await captureError(
        tx,
        `SELECT app.create_invitation($1, $2, now() + interval '7 days')`,
        [pidA, "eve@test.com"],
      );
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/caller is not an owner/i);
    });
  });

  // T5: p_expires_at en pasado → P0001 'expires_at must be in the future'.
  // La función rechaza explícitamente fechas no-futuras (no delega a CHECK).
  it("denial: expires_at en pasado → P0001 'expires_at must be in the future'", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(
        tx,
        `SELECT app.create_invitation($1, $2, now() - interval '1 day')`,
        [pidA, "eve@test.com"],
      );
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/expires_at must be in the future/i);
    });
  });

  // T6: expires_at boundary exactamente now() → mismo error (strict >, no >=).
  // Defensa contra el caller que pasa now() del cliente esperando que sea
  // "ahora" — el servidor evalúa now() server-side; ambos deberían ser
  // efectivamente idénticos. Strict > previene ambigüedad de zero-duration.
  it("denial: expires_at = now() exact (strict > boundary) → mismo P0001 'in the future'", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(
        tx,
        `SELECT app.create_invitation($1, $2, now())`,
        [pidA, "eve@test.com"],
      );
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/expires_at must be in the future/i);
    });
  });

  // (El viejo T7 "multi-owner: co-owner puede invitar" se eliminó con
  // ADR-0054 — no existen co-owners; el gate owner-of-place queda cubierto
  // por T1/T3/T4.)

  // T8: token uniqueness — 2 invocaciones consecutivas con el mismo caller
  // generan tokens distintos. Defensa contra una generation strategy que
  // pudiera colisionar. Validación probabilística sobre 5 invocaciones —
  // 256 bits de entropy hace colisión imposible en práctica; el test
  // verifica que la función NO retorna el mismo token determinístico por
  // accidente (e.g., reuso de UUID por bug).
  it("contract: 5 invocaciones generan 5 tokens distintos (uniqueness)", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authA");
      const tokens = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const rows = (await tx.q(
          `SELECT app.create_invitation($1, $2, now() + interval '7 days') AS j`,
          [pidA, `e${i}@test.com`],
        )) as Array<{ j: { token: string } }>;
        tokens.add(rows[0].j.token);
      }
      expect(tokens.size).toBe(5);
    });
  });

  // T9: email passthrough sin re-validación — la función NO valida formato
  // del email (delega a zod app-side); la fila se inserta tal cual. Fija el
  // contract: defense-in-depth zod app-side es la única validación de
  // formato; la DEFINER trata el email como string opaco.
  it("contract: email malformado pasa (sin re-validación) — defense-in-depth en zod app-side", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authA");
      const rows = (await tx.q(
        `SELECT app.create_invitation($1, $2, now() + interval '7 days') AS j`,
        [pidA, "not-an-email"],
      )) as Array<{ j: { invitation_id: string } }>;
      const inv = (await tx.seed(
        `SELECT email FROM invitation WHERE id = $1`,
        [rows[0].j.invitation_id],
      )) as Array<{ email: string }>;
      expect(inv[0].email).toBe("not-an-email"); // raw passthrough.
    });
  });

  // T10: place not found — el helper `current_user_owns_place` retorna
  // false para place inexistente (no hay fila en place_ownership con
  // place_id = 'nonexistent'); el caller "no es owner" trivialmente,
  // entonces el error es el mismo que T3/T4 (anti-info-leak: no diferenciar
  // place-not-found de no-owner para no exponer existencia de place_ids).
  it("denial: place_id inexistente → mismo P0001 'not an owner' (anti-info-leak)", async () => {
    await inRlsTx(async (tx) => {
      await seedScenario(tx);
      await tx.as("authA");
      const err = await captureError(
        tx,
        `SELECT app.create_invitation($1, $2, now() + interval '7 days')`,
        ["nonexistent_place_id", "eve@test.com"],
      );
      expect(err.code).toBe("P0001");
      expect(err.message).toMatch(/caller is not an owner/i);
    });
  });
});
