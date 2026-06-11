import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";

// Feature D · S5 (regression sobre migration 0013, ADR-0035, 2026-05-24).
// Migration 0013 (anticipada en S1 — ver plan-sesiones.md §Status) refactorizó
// `app.create_place` para incluir `founder_user_id := caller.user_id` en ambos
// overloads (5-arg + 6-arg). Estos 5 tests fijan el contract observable:
//
//   T1. 6-arg overload (runtime actual, ADR-0022): caller alice
//       → place.founder_user_id = alice.app_user.id.
//   T2. 5-arg overload (compat surface, callers legacy): mismo invariante.
//   T3. Multi-user distinct: alice/bob/carol crean places distintos
//       → cada place tiene el founder del creator (cero cross-contaminación).
//   T4. Back-fill idempotente: re-ejecutar el UPDATE MIN(granted_at) de
//       migration 0012 NO cambia datos existentes — propiedad clave para
//       reverse-SQL seguro y para re-aplicación accidental en branches test.
//       Post-ADR-0054 (single-owner, migration 0029) el escenario es 1 fila
//       de ownership por place (UNIQUE place_ownership(place_id)) — el MIN
//       es trivial pero la propiedad de no-op sigue vigente.
//   T5. ADR-0012 contract preservado: post-refactor, app.create_place sigue
//       creando atómicamente la trupla (place, place_ownership, membership) —
//       el wire-up del founder no rompió el saga de creación.
//
// Sin RED phase explícita: la implementación se aplicó en S1 (migration 0013).
// Los 5 tests pasan green por construcción y actúan como regression guards —
// si alguien rompe el wire-up del founder en una migration futura (e.g., DROP
// FUNCTION sin re-CREATE OR REPLACE con la columna), la suite se vuelve roja
// y el bug se atrapa pre-deploy.

afterAll(() => endRlsAdminPool());

async function seedUser(tx: RlsTx, auth: string, suffix: string) {
  const [{ id }] = (await tx.seed(
    `INSERT INTO app_user (auth_user_id,email,display_name,handle)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [auth, `${suffix}@x.com`, suffix.toUpperCase(), `h_${suffix}`],
  )) as Array<{ id: string }>;
  return id;
}

// 6-arg: signature actual usada por el wizard (ADR-0022 default_locale).
const createPlace6 = (tx: RlsTx, slug: string, name = "P") =>
  tx.q(
    `SELECT app.create_place($1,$2,NULL,'{}'::jsonb,'{}'::jsonb,'es') AS pid`,
    [slug, name],
  ) as Promise<Array<{ pid: string }>>;

// 5-arg: compat surface para callers legacy (sin default_locale, toma DEFAULT 'es').
const createPlace5 = (tx: RlsTx, slug: string, name = "P") =>
  tx.q(
    `SELECT app.create_place($1,$2,NULL,'{}'::jsonb,'{}'::jsonb) AS pid`,
    [slug, name],
  ) as Promise<Array<{ pid: string }>>;

// Admin bypass para leer founder_user_id sin pasar por RLS de place
// (lectura es defensa, no asserción RLS — RLS de place ya cubierta en otras suites).
const founderOfAdmin = async (tx: RlsTx, pid: string) => {
  const rows = (await tx.seed(
    `SELECT founder_user_id FROM place WHERE id = $1`,
    [pid],
  )) as Array<{ founder_user_id: string | null }>;
  return rows[0]?.founder_user_id ?? null;
};

describe("Feature D · S5 — app.create_place setea founder_user_id (regression migration 0013)", () => {
  it("T1 6-arg overload: place.founder_user_id = caller.app_user.id", async () => {
    await inRlsTx(async (tx) => {
      const uAlice = await seedUser(tx, "authAlice", "alice");
      await tx.as("authAlice");
      const [{ pid }] = await createPlace6(tx, "place-a", "Place A");
      expect(pid).toBeTruthy();
      const founder = await founderOfAdmin(tx, pid);
      expect(founder).toBe(uAlice);
    });
  });

  it("T2 5-arg overload (compat surface): place.founder_user_id = caller.app_user.id", async () => {
    await inRlsTx(async (tx) => {
      const uAlice = await seedUser(tx, "authAlice", "alice");
      await tx.as("authAlice");
      const [{ pid }] = await createPlace5(tx, "place-a-5arg", "Place A 5arg");
      expect(pid).toBeTruthy();
      const founder = await founderOfAdmin(tx, pid);
      expect(founder).toBe(uAlice);
    });
  });

  it("T3 multi-user distinct: 3 places de 3 creators → 3 founder_user_id distintos matching", async () => {
    await inRlsTx(async (tx) => {
      const uAlice = await seedUser(tx, "authAlice", "alice");
      const uBob = await seedUser(tx, "authBob", "bob");
      const uCarol = await seedUser(tx, "authCarol", "carol");

      await tx.as("authAlice");
      const [{ pid: pidA }] = await createPlace6(tx, "place-a", "Place A");
      await tx.as("authBob");
      const [{ pid: pidB }] = await createPlace6(tx, "place-b", "Place B");
      await tx.as("authCarol");
      const [{ pid: pidC }] = await createPlace6(tx, "place-c", "Place C");

      const fA = await founderOfAdmin(tx, pidA);
      const fB = await founderOfAdmin(tx, pidB);
      const fC = await founderOfAdmin(tx, pidC);

      expect(fA).toBe(uAlice);
      expect(fB).toBe(uBob);
      expect(fC).toBe(uCarol);
      // Cero cross-contaminación: 3 founders distintos.
      expect(new Set([fA, fB, fC]).size).toBe(3);
    });
  });

  it("T4 back-fill idempotente: re-ejecutar el UPDATE MIN(granted_at) NO cambia datos", async () => {
    await inRlsTx(async (tx) => {
      const uAlice = await seedUser(tx, "authAlice", "alice");
      await tx.as("authAlice");
      const [{ pid }] = await createPlace6(tx, "place-a", "Place A");

      // Post-ADR-0054 NO se puede sembrar un segundo owner (el UNIQUE
      // place_ownership(place_id) de migration 0029 lo rechaza con 23505);
      // el escenario canónico es la única fila del founder que dejó
      // app.create_place. La propiedad bajo test se reduce a: re-correr el
      // back-fill de 0012 es no-op sobre datos correctos pre-existentes.
      const founderBefore = await founderOfAdmin(tx, pid);
      expect(founderBefore).toBe(uAlice);

      // Simular re-aplicación del back-fill statement de migration 0012.
      // Idempotencia = re-correr no cambia datos correctos pre-existentes.
      await tx.seed(
        `UPDATE place SET founder_user_id = (
           SELECT user_id FROM place_ownership
           WHERE place_id = place.id
           ORDER BY granted_at ASC LIMIT 1
         ) WHERE id = $1`,
        [pid],
      );

      const founderAfter = await founderOfAdmin(tx, pid);
      expect(founderAfter).toBe(uAlice);
      expect(founderAfter).toBe(founderBefore);
    });
  });

  it("T5 ADR-0012 contract preservado: place + place_ownership + membership creados atómicamente", async () => {
    await inRlsTx(async (tx) => {
      const uAlice = await seedUser(tx, "authAlice", "alice");
      await tx.as("authAlice");
      const [{ pid }] = await createPlace6(tx, "place-a", "Place A");

      // (a) place existe con founder seteado (Feature D delta) + invariantes
      //     billing/trial preservados (ADR-0012 contract original).
      const placeRows = (await tx.seed(
        `SELECT id, founder_user_id, billing_mode, subscription_status,
                (trial_ends_at BETWEEN now()+interval '29 days'
                                   AND now()+interval '31 days') AS trial_ok
           FROM place WHERE id = $1`,
        [pid],
      )) as Array<{
        id: string;
        founder_user_id: string;
        billing_mode: string;
        subscription_status: string;
        trial_ok: boolean;
      }>;
      expect(placeRows).toHaveLength(1);
      expect(placeRows[0].founder_user_id).toBe(uAlice);
      expect(placeRows[0].billing_mode).toBe("OWNER_PAYS");
      expect(placeRows[0].subscription_status).toBe("ACTIVE");
      expect(placeRows[0].trial_ok).toBe(true);

      // (b) place_ownership: fila inicial del caller (ADR-0012 contract).
      const ownsRows = (await tx.seed(
        `SELECT count(*)::int AS n FROM place_ownership
           WHERE place_id = $1 AND user_id = $2`,
        [pid, uAlice],
      )) as Array<{ n: number }>;
      expect(ownsRows[0].n).toBe(1);

      // (c) membership: fila activa del caller (ADR-0012 contract).
      const memRows = (await tx.seed(
        `SELECT count(*)::int AS n FROM membership
           WHERE place_id = $1 AND user_id = $2 AND left_at IS NULL`,
        [pid, uAlice],
      )) as Array<{ n: number }>;
      expect(memRows[0].n).toBe(1);
    });
  });
});
