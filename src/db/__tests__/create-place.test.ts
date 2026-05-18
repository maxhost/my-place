import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";

// S3: `app.create_place(...)` SECURITY DEFINER (ADR-0012 §3) — la ÚNICA vía de
// creación. Se siembra el `app_user` como dueño (RLS no aplica), se baja a
// `app_system` con el claim del caller y se invoca la función como en runtime.
// Verificado empíricamente 2026-05-17: dentro del DEFINER (dueño neondb_owner,
// BYPASSRLS) `app.current_user_id()` lee el GUC tx-local del CALLER.

afterAll(() => endRlsAdminPool());

// Crea el `app_user` del caller `auth`. Devuelve su id.
async function seedUser(tx: RlsTx, auth: string, suffix: string) {
  const [{ id }] = (await tx.seed(
    `INSERT INTO app_user (auth_user_id,email,display_name,handle)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [auth, `${suffix}@x.com`, suffix.toUpperCase(), `h_${suffix}`],
  )) as Array<{ id: string }>;
  return id;
}

const createPlace = (tx: RlsTx, slug: string, name = "P", desc: string | null = null) =>
  tx.q(
    `SELECT app.create_place($1,$2,$3,'{}'::jsonb,'{}'::jsonb) AS pid`,
    [slug, name, desc],
  ) as Promise<Array<{ pid: string }>>;

describe("S3 app.create_place — creación atómica del caller (ADR-0012 §3)", () => {
  it("crea place fresco + caller owner+miembro, billing/trial deterministas", async () => {
    await inRlsTx(async (tx) => {
      const uA = await seedUser(tx, "authA", "a");
      await tx.as("authA");
      const [{ pid }] = await createPlace(tx, "place-a", "Place A");
      expect(pid).toBeTruthy();
      // el caller (ahora owner) ve su place vía las policies owner-only de S2
      const [pl] = (await tx.q(
        `SELECT slug,name,billing_mode,subscription_status,enabled_features,
                (trial_ends_at BETWEEN now()+interval '29 days'
                                   AND now()+interval '31 days') AS trial_ok
           FROM place WHERE id=$1`,
        [pid],
      )) as Array<Record<string, unknown>>;
      expect(pl).toMatchObject({
        slug: "place-a",
        name: "Place A",
        billing_mode: "OWNER_PAYS",
        subscription_status: "ACTIVE",
        trial_ok: true,
      });
      expect(pl.enabled_features).toEqual([]);
      const owns = (await tx.q(
        `SELECT count(*)::int n FROM place_ownership WHERE place_id=$1 AND user_id=$2`,
        [pid, uA],
      )) as Array<{ n: number }>;
      const mem = (await tx.q(
        `SELECT count(*)::int n FROM membership WHERE place_id=$1 AND user_id=$2`,
        [pid, uA],
      )) as Array<{ n: number }>;
      expect(owns[0].n).toBe(1);
      expect(mem[0].n).toBe(1);
    });
  });

  it("sin claim → rechaza (no autenticado)", async () => {
    await inRlsTx(async (tx) => {
      await seedUser(tx, "authA", "a");
      await tx.as(null);
      expect(
        await tx.denied(`SELECT app.create_place('p','P',NULL,'{}'::jsonb,'{}'::jsonb)`),
      ).toBe(true);
    });
  });

  it("app_user inexistente para el caller → rechaza", async () => {
    await inRlsTx(async (tx) => {
      await seedUser(tx, "authA", "a");
      await tx.as("ghost"); // claim válido pero sin app_user
      expect(
        await tx.denied(`SELECT app.create_place('p','P',NULL,'{}'::jsonb,'{}'::jsonb)`),
      ).toBe(true);
    });
  });

  it("no acepta place_id ajeno: B crea su propio place, el de A queda intacto", async () => {
    await inRlsTx(async (tx) => {
      const uA = await seedUser(tx, "authA", "a");
      await seedUser(tx, "authB", "b");
      await tx.as("authA");
      const [{ pid: pidA }] = await createPlace(tx, "place-a");
      await tx.as("authB");
      const [{ pid: pidB }] = await createPlace(tx, "place-b");
      expect(pidB).not.toBe(pidA); // place fresco, no se apunta a uno ajeno
      // B no es owner del place de A (no hay parámetro place_id que falsear)
      await tx.as("authA");
      const aOwns = (await tx.q(
        `SELECT user_id FROM place_ownership WHERE place_id=$1`,
        [pidA],
      )) as Array<{ user_id: string }>;
      expect(aOwns).toHaveLength(1);
      expect(aOwns[0].user_id).toBe(uA);
    });
  });

  it("slug duplicado → la violación UNIQUE propaga (rechaza)", async () => {
    await inRlsTx(async (tx) => {
      await seedUser(tx, "authA", "a");
      await tx.as("authA");
      await createPlace(tx, "dup");
      expect(await tx.denied(`SELECT app.create_place('dup','P2',NULL,'{}'::jsonb,'{}'::jsonb)`)).toBe(
        true,
      );
    });
  });

  it("EXECUTE concedido a app_system y denegado a PUBLIC", async () => {
    await inRlsTx(async (tx) => {
      const sig = "app.create_place(text,text,text,jsonb,jsonb)";
      const [acl] = (await tx.seed(
        `SELECT has_function_privilege('app_system',$1,'EXECUTE') AS sys,
                has_function_privilege('public',$1,'EXECUTE') AS pub`,
        [sig],
      )) as Array<{ sys: boolean; pub: boolean }>;
      expect(acl.sys).toBe(true);
      expect(acl.pub).toBe(false);
    });
  });
});
