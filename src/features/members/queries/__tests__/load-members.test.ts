import { afterAll, describe, expect, it } from "vitest";
import {
  endRlsAdminPool,
  inRlsTx,
  type RlsTx,
} from "@/db/__tests__/db-test-pool";
import { loadMembers } from "../load-members";

// Feature E · S6 (tests.md §S6, 2026-05-24) — query foundation del slice
// `members`. `loadMembers(executor, placeId)` retorna `Member[]` para la
// UI de S10 (`<MembersList />`). Filtra `left_at IS NULL` (sólo activos)
// + JOIN `app_user` (identidad universal) + LEFT JOIN `place_ownership`
// (deriva `isOwner`) + comparación con `place.founder_user_id` (deriva
// `isFounder`).
//
// RLS aplica naturalmente: el SELECT a `membership` es owner-only
// (`membership_sel` con `ownerOnly(t.placeId)`); el LEFT JOIN a
// `place_ownership` también es owner-only (`po_sel` con
// `app.current_user_owns_place(t.placeId)`). Si el caller NO es owner del
// place, ambas tablas filtran y la query retorna `[]` — comportamiento
// fail-soft sin throw (mismo patrón que `loadPlaceBySlug` para
// no-owner).
//
// Patrón seed-as-owner / assert-as-`app_system` heredado de
// `remove-member.test.ts` (S4) y `load-place-by-slug.test.ts` (settings
// S3). ROLLBACK siempre (cero footprint en branch `test`).

afterAll(() => endRlsAdminPool());

const APP_USER = `INSERT INTO app_user (auth_user_id,email,display_name,handle,avatar_url)
                  VALUES ($1,$2,$3,$4,$5) RETURNING id`;
const PLACE = `INSERT INTO place (slug,name,billing_mode,founder_user_id)
               VALUES ($1,$2,'OWNER_PAYS',$3) RETURNING id`;

// Escenario canónico S6 (compartido con load-pending-invitations.test.ts):
//   - place-a: alice founder+owner, bob co-owner, carol miembro activo
//     no-owner, dave ex-miembro (left_at NOT NULL), todos con headlines
//     mixtos para verificar el passthrough.
//   - eve: app_user existe pero SIN membership en place-a (test #3 — no
//     debería aparecer).
//   - Ordenamiento: joined_at sembrado con offsets explícitos para que el
//     ORDER BY DESC sea verificable (alice más vieja, carol más nueva).
async function seedScenario(tx: RlsTx) {
  const [{ id: uA }] = (await tx.seed(APP_USER, [
    "authA",
    "a@x.com",
    "Alice Founder",
    "alice",
    "https://cdn.example/alice.png",
  ])) as Array<{ id: string }>;
  const [{ id: uB }] = (await tx.seed(APP_USER, [
    "authB",
    "b@x.com",
    "Bob Owner",
    "bob",
    null,
  ])) as Array<{ id: string }>;
  const [{ id: uC }] = (await tx.seed(APP_USER, [
    "authC",
    "c@x.com",
    "Carol Member",
    "carol",
    "https://cdn.example/carol.png",
  ])) as Array<{ id: string }>;
  const [{ id: uD }] = (await tx.seed(APP_USER, [
    "authD",
    "d@x.com",
    "Dave Ex",
    "dave",
    null,
  ])) as Array<{ id: string }>;
  const [{ id: uE }] = (await tx.seed(APP_USER, [
    "authE",
    "e@x.com",
    "Eve Outsider",
    "eve",
    null,
  ])) as Array<{ id: string }>;
  const [{ id: pidA }] = (await tx.seed(PLACE, [
    "place-a",
    "Place A",
    uA,
  ])) as Array<{ id: string }>;
  // alice founder+owner; bob co-owner. carol miembro no-owner. Sin fila en
  // place_ownership para carol/dave/eve.
  await tx.seed(
    `INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`,
    [uA, pidA],
  );
  await tx.seed(
    `INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`,
    [uB, pidA],
  );
  // Memberships activas con joined_at controlado (alice vieja, bob medio,
  // carol nueva) + headlines mixtos para validar passthrough NULL/value.
  await tx.seed(
    `INSERT INTO membership (user_id,place_id,joined_at,headline)
       VALUES ($1,$2,'2026-01-01T00:00:00Z',$3)`,
    [uA, pidA, "Fundadora"],
  );
  await tx.seed(
    `INSERT INTO membership (user_id,place_id,joined_at,headline)
       VALUES ($1,$2,'2026-03-01T00:00:00Z',$3)`,
    [uB, pidA, null],
  );
  await tx.seed(
    `INSERT INTO membership (user_id,place_id,joined_at,headline)
       VALUES ($1,$2,'2026-05-01T00:00:00Z',$3)`,
    [uC, pidA, "Recién en el barrio"],
  );
  // Dave: ex-miembro (left_at NOT NULL). NO debería aparecer en la query.
  await tx.seed(
    `INSERT INTO membership (user_id,place_id,joined_at,left_at)
       VALUES ($1,$2,'2026-02-01T00:00:00Z',now())`,
    [uD, pidA],
  );
  return { uA, uB, uC, uD, uE, pidA };
}

describe("loadMembers — query foundation slice members (S6, ADR-0035 + ADR-0036)", () => {
  // T1: happy — alice (founder+owner) ve los 3 miembros activos del place
  // con shape canónico Member completo (8 campos). Sanity de cantidad +
  // shape de campos. Ordenamiento DESC por joined_at → carol (mayo) primero,
  // bob (marzo) en medio, alice (enero) última.
  it("happy: caller owner founder → array con 3 miembros activos shape Member completo", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authA");

      const members = await loadMembers(tx.q, pidA);

      expect(members).toHaveLength(3);
      // Orden esperado DESC: carol (más nueva) primero.
      expect(members[0]!.handle).toBe("carol");
      expect(members[1]!.handle).toBe("bob");
      expect(members[2]!.handle).toBe("alice");
      // Shape canónico Member: los 8 campos presentes con tipos correctos.
      const carol = members[0]!;
      expect(carol.displayName).toBe("Carol Member");
      expect(carol.handle).toBe("carol");
      expect(carol.avatarUrl).toBe("https://cdn.example/carol.png");
      expect(carol.headline).toBe("Recién en el barrio");
      expect(carol.joinedAt).toBeInstanceOf(Date);
      expect(carol.userId).toBeTruthy();
      expect(typeof carol.isOwner).toBe("boolean");
      expect(typeof carol.isFounder).toBe("boolean");
    });
  });

  // T2: filter ex-miembros — dave (left_at NOT NULL) NO debe aparecer.
  // Sanity: los 3 activos están, dave NO está.
  it("filter: ex-miembros (left_at NOT NULL) NO aparecen en la lista", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authA");

      const members = await loadMembers(tx.q, pidA);

      const handles = members.map((m) => m.handle);
      expect(handles).toContain("alice");
      expect(handles).toContain("bob");
      expect(handles).toContain("carol");
      expect(handles).not.toContain("dave");
    });
  });

  // T3: filter no-miembros — eve (sin membership en place-a) NO debe
  // aparecer. Sanity: eve es app_user real, sólo le falta la fila en
  // membership.
  it("filter: app_users sin membership NO aparecen en la lista", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authA");

      const members = await loadMembers(tx.q, pidA);

      const handles = members.map((m) => m.handle);
      expect(handles).not.toContain("eve");
    });
  });

  // T4: founder badge — alice (founder + owner por ADR-0035 §2) viene con
  // isFounder=true Y isOwner=true. La derivación de isFounder es vía
  // comparación con `place.founder_user_id`; la de isOwner vía LEFT JOIN
  // `place_ownership`.
  it("badge derivation: founder → isFounder=true AND isOwner=true", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authA");

      const members = await loadMembers(tx.q, pidA);

      const alice = members.find((m) => m.handle === "alice");
      expect(alice).toBeDefined();
      expect(alice!.isFounder).toBe(true);
      expect(alice!.isOwner).toBe(true);
    });
  });

  // T5: co-owner badge — bob (owner pero no founder) viene con
  // isFounder=false Y isOwner=true.
  it("badge derivation: co-owner → isFounder=false AND isOwner=true", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authA");

      const members = await loadMembers(tx.q, pidA);

      const bob = members.find((m) => m.handle === "bob");
      expect(bob).toBeDefined();
      expect(bob!.isFounder).toBe(false);
      expect(bob!.isOwner).toBe(true);
    });
  });

  // T6: miembro no-owner — carol (sólo membership, sin place_ownership)
  // viene con isFounder=false Y isOwner=false. Confirma que el LEFT JOIN
  // produce NULL → isOwner=false cuando no hay match.
  it("badge derivation: miembro no-owner → isFounder=false AND isOwner=false", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authA");

      const members = await loadMembers(tx.q, pidA);

      const carol = members.find((m) => m.handle === "carol");
      expect(carol).toBeDefined();
      expect(carol!.isFounder).toBe(false);
      expect(carol!.isOwner).toBe(false);
    });
  });

  // T7: caller no-owner del place — carol (miembro activo no-owner)
  // invoca loadMembers. Comportamiento canónico post ADR-0021 + ADR-0038:
  // - `membership_sel` (owner-OR-self): carol ve sólo SU PROPIA membership row.
  // - `au_self` + `au_peer_member_read`: carol puede leer su propio app_user.
  // - `po_sel` (owner-only via DEFINER): carol NO está en place_ownership →
  //   LEFT JOIN retorna NULL → isOwner=false.
  // - Comparación `m.user_id = p.founder_user_id` para isFounder: carol no
  //   es founder → false.
  // Resultado: 1 fila (la propia membership de carol) con isOwner=false,
  // isFounder=false. NO es [] — eso era expectativa pre-ADR-0021/0038, y
  // la realidad es self-read. El page `/settings/members` (S11) impondrá
  // owner-only gating en su propia capa, no en esta query.
  it("self-read: caller miembro no-owner → ve SU propia membership row (post ADR-0021/0038)", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authC"); // carol miembro no-owner

      const members = await loadMembers(tx.q, pidA);

      expect(members).toHaveLength(1);
      expect(members[0]!.handle).toBe("carol");
      expect(members[0]!.isOwner).toBe(false);
      expect(members[0]!.isFounder).toBe(false);
    });
  });
});
