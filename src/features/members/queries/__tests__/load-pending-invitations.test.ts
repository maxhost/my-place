import { afterAll, describe, expect, it } from "vitest";
import {
  endRlsAdminPool,
  inRlsTx,
  type RlsTx,
} from "@/db/__tests__/db-test-pool";
import { loadPendingInvitations } from "../load-pending-invitations";

// Feature E · S6 (tests.md §S6, 2026-05-24) — query foundation del slice
// `members` para el tab "Pendientes" de `/settings/members`.
// `loadPendingInvitations(executor, placeId)` retorna `PendingInvitation[]`
// con sólo las invitaciones accionables (pending no expiradas), ordenadas
// por urgencia (`expires_at ASC` — las que vencen antes primero).
//
// La RLS owner-only de `invitation` (`invitation_all` FOR ALL con
// `ownerOnly(t.placeId)`) hace el guard naturalmente: si el caller no es
// owner del place, la query retorna `[]` sin throw.
//
// Patrón seed-as-owner / assert-as-`app_system` idéntico a
// `load-members.test.ts`. ROLLBACK siempre.

afterAll(() => endRlsAdminPool());

const APP_USER = `INSERT INTO app_user (auth_user_id,email,display_name,handle)
                  VALUES ($1,$2,$3,$4) RETURNING id`;
const PLACE = `INSERT INTO place (slug,name,billing_mode,founder_user_id)
               VALUES ($1,$2,'OWNER_PAYS',$3) RETURNING id`;
const INVITATION = `INSERT INTO invitation (place_id,email,invited_by,expires_at,token,accepted_at)
                    VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`;

// Escenario S6 para invitations:
//   - place-a: alice founder+owner, bob co-owner (multi-owner — alice y
//     bob pueden ver pendientes), carol miembro no-owner (NO debe ver).
//   - invitaciones en place-a:
//       - inv_far: pending, expira 90 días (más holgada → ORDER segunda).
//       - inv_near: pending, expira 1 hora (más urgente → ORDER primera).
//       - inv_accepted: accepted_at NOT NULL (debe filtrarse).
//       - inv_expired: pending pero expires_at en pasado (debe filtrarse).
//   - El invited_by de cada una alternates alice/bob para verificar el
//     JOIN `app_user` que computa `invitedByDisplayName`.
async function seedScenario(tx: RlsTx) {
  const [{ id: uA }] = (await tx.seed(APP_USER, [
    "authA",
    "a@x.com",
    "Alice Founder",
    "alice",
  ])) as Array<{ id: string }>;
  const [{ id: uB }] = (await tx.seed(APP_USER, [
    "authB",
    "b@x.com",
    "Bob Owner",
    "bob",
  ])) as Array<{ id: string }>;
  const [{ id: uC }] = (await tx.seed(APP_USER, [
    "authC",
    "c@x.com",
    "Carol Member",
    "carol",
  ])) as Array<{ id: string }>;
  const [{ id: pidA }] = (await tx.seed(PLACE, [
    "place-a",
    "Place A",
    uA,
  ])) as Array<{ id: string }>;
  await tx.seed(
    `INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`,
    [uA, pidA],
  );
  await tx.seed(
    `INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`,
    [uB, pidA],
  );
  await tx.seed(`INSERT INTO membership (user_id,place_id) VALUES ($1,$2)`, [
    uA,
    pidA,
  ]);
  await tx.seed(`INSERT INTO membership (user_id,place_id) VALUES ($1,$2)`, [
    uB,
    pidA,
  ]);
  await tx.seed(`INSERT INTO membership (user_id,place_id) VALUES ($1,$2)`, [
    uC,
    pidA,
  ]);
  // inv_far: pending, expira en ~90 días (futuro lejano), invitada por alice.
  const [{ id: invFar }] = (await tx.seed(INVITATION, [
    pidA,
    "far@test.com",
    uA,
    new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    "tok_far",
    null,
  ])) as Array<{ id: string }>;
  // inv_near: pending, expira en 1 hora (futuro cercano), invitada por bob.
  const [{ id: invNear }] = (await tx.seed(INVITATION, [
    pidA,
    "near@test.com",
    uB,
    new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    "tok_near",
    null,
  ])) as Array<{ id: string }>;
  // inv_accepted: pending hace 30 días pero ya aceptada (accepted_at NOT
  // NULL). Debe filtrarse — la persona ya joineó, no hay capability viva.
  const [{ id: invAccepted }] = (await tx.seed(INVITATION, [
    pidA,
    "accepted@test.com",
    uA,
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    "tok_accepted",
    new Date().toISOString(),
  ])) as Array<{ id: string }>;
  // inv_expired: pending nunca aceptada pero expires_at ya pasó. V1
  // muestra sólo accionables — expired no se renderea (purga eventual).
  const [{ id: invExpired }] = (await tx.seed(INVITATION, [
    pidA,
    "expired@test.com",
    uA,
    new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    "tok_expired",
    null,
  ])) as Array<{ id: string }>;
  return { uA, uB, uC, pidA, invFar, invNear, invAccepted, invExpired };
}

describe("loadPendingInvitations — query foundation slice members (S6, ADR-0010 §2)", () => {
  // T1: happy — alice (founder+owner) ve las 2 invitaciones accionables
  // (inv_near + inv_far). Sanity de cantidad + shape (4 campos).
  it("happy: caller owner → array con 2 pending shape PendingInvitation completo", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authA");

      const invitations = await loadPendingInvitations(tx.q, pidA);

      expect(invitations).toHaveLength(2);
      // Shape canónico PendingInvitation: 4 campos presentes con tipos.
      const first = invitations[0]!;
      expect(typeof first.invitationId).toBe("string");
      expect(first.invitationId).toBeTruthy();
      expect(typeof first.email).toBe("string");
      expect(first.expiresAt).toBeInstanceOf(Date);
      expect(typeof first.invitedByDisplayName).toBe("string");
      expect(first.invitedByDisplayName).toBeTruthy();
    });
  });

  // T2: filter accepted — accepted_at NOT NULL no aparece. Sanity: los
  // emails listados son SOLO los pending (far + near), accepted@ NO está.
  it("filter: accepted (accepted_at NOT NULL) NO aparece", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authA");

      const invitations = await loadPendingInvitations(tx.q, pidA);

      const emails = invitations.map((i) => i.email);
      expect(emails).not.toContain("accepted@test.com");
    });
  });

  // T3: filter expired — expires_at <= now() no aparece. V1 muestra sólo
  // accionables; expired se purga eventualmente fuera del scope V1.
  it("filter: expired (expires_at <= now) NO aparece — V1 muestra sólo accionables", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authA");

      const invitations = await loadPendingInvitations(tx.q, pidA);

      const emails = invitations.map((i) => i.email);
      expect(emails).not.toContain("expired@test.com");
    });
  });

  // T4: RLS — carol (miembro no-owner del place) invoca loadPendingInvitations.
  // La RLS owner-only de `invitation_all` filtra todas las filas → []
  // sin throw. Comportamiento fail-soft consistente con loadMembers T7.
  it("RLS: caller miembro no-owner → retorna [] (invitation_all filtra)", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authC"); // carol miembro no-owner

      const invitations = await loadPendingInvitations(tx.q, pidA);

      expect(invitations).toEqual([]);
    });
  });

  // T5: ordenamiento — `expires_at ASC` (más urgentes primero). inv_near
  // (1h) debe venir antes que inv_far (90d). UX rationale: el owner ve
  // primero lo que vence pronto. JOIN con app_user también valida
  // invitedByDisplayName real (bob para near, alice para far).
  it("orden: expires_at ASC (más urgentes primero) + JOIN invited_by resuelve display_name", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authA");

      const invitations = await loadPendingInvitations(tx.q, pidA);

      expect(invitations).toHaveLength(2);
      expect(invitations[0]!.email).toBe("near@test.com");
      expect(invitations[0]!.invitedByDisplayName).toBe("Bob Owner");
      expect(invitations[1]!.email).toBe("far@test.com");
      expect(invitations[1]!.invitedByDisplayName).toBe("Alice Founder");
      // Orden temporal: el primero debe ser anterior al segundo.
      expect(invitations[0]!.expiresAt.getTime()).toBeLessThan(
        invitations[1]!.expiresAt.getTime(),
      );
    });
  });
});
