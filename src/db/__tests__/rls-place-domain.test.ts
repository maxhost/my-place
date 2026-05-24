import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";

// RLS Owner-only hardening de `place_domain` (policy `place_domain_all` FOR ALL,
// USING == WITH CHECK; `0001_round_forge.sql:39-45`) + structural drift defense.
// Bajo `app_system` (NO BYPASSRLS). Canónica: `docs/gotchas/rls-place-domain-owner-only.md`.

afterAll(() => endRlsAdminPool());

const APP_USER = `INSERT INTO app_user (auth_user_id,email,display_name,handle) VALUES ($1,$2,'X',$3) RETURNING id`;
const PLACE = `INSERT INTO place (slug,name,billing_mode) VALUES ($1,$2,'OWNER_PAYS') RETURNING id`;

async function seedPlaceA(tx: RlsTx) {
  const [{ id: uA }] = (await tx.seed(APP_USER, ["authA", "a@x.com", "handle_a"])) as Array<{ id: string }>;
  const [{ id: uB }] = (await tx.seed(APP_USER, ["authB", "b@x.com", "handle_b"])) as Array<{ id: string }>;
  const [{ id: pidA }] = (await tx.seed(PLACE, ["place-a", "Place A"])) as Array<{ id: string }>;
  await tx.seed(`INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`, [uA, pidA]);
  const [{ id: domainId }] = (await tx.seed(
    `INSERT INTO place_domain (place_id,domain) VALUES ($1,'a.example') RETURNING id`,
    [pidA],
  )) as Array<{ id: string }>;
  return { uA, uB, pidA, domainId };
}

async function seedSecondPlaceOwnedBy(tx: RlsTx, ownerUserId: string, slug: string) {
  const [{ id: pid }] = (await tx.seed(PLACE, [slug, "Other"])) as Array<{ id: string }>;
  await tx.seed(`INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`, [ownerUserId, pid]);
  return pid;
}

async function joinAsMember(tx: RlsTx, userId: string, placeId: string) {
  await tx.seed(`INSERT INTO membership (user_id,place_id) VALUES ($1,$2)`, [userId, placeId]);
}

const countDomains = async (tx: RlsTx) =>
  Number(((await tx.q(`SELECT count(*)::int n FROM place_domain`)) as Array<{ n: number }>)[0].n);

// UPDATE/DELETE bajo RLS no tiran: la policy filtra el WHERE → 0 rows.
async function affectedUpdate(tx: RlsTx, pidA: string, set: string) {
  return ((await tx.q(`UPDATE place_domain SET ${set} WHERE place_id=$1 RETURNING id`, [pidA])) as Array<{ id: string }>).length;
}
async function affectedDelete(tx: RlsTx, pidA: string) {
  return ((await tx.q(`DELETE FROM place_domain WHERE place_id=$1 RETURNING id`, [pidA])) as Array<{ id: string }>).length;
}

describe("S1 RLS — partial unique permite reuso post-archive (ADR-0026)", () => {
  it("INSERT duplicado con fila activa falla (UNIQUE)", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedPlaceA(tx);
      await tx.as("authA");
      expect(
        await tx.denied(`INSERT INTO place_domain (place_id,domain) VALUES ($1,'a.example')`, [
          pidA,
        ]),
      ).toBe(true);
    });
  });

  it("tras archivar la fila, el mismo dominio puede re-registrarse en el mismo place", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedPlaceA(tx);
      await tx.as("authA");
      await tx.q(
        `UPDATE place_domain SET archived_at=now() WHERE place_id=$1 AND domain='a.example'`,
        [pidA],
      );
      // tx.q directo (no tx.denied): denied envuelve en SAVEPOINT+ROLLBACK;
      // acá necesitamos persistir para asertar el invariante 1 activa+2 total.
      await tx.q(`INSERT INTO place_domain (place_id,domain) VALUES ($1,'a.example')`, [pidA]);
      const r = (await tx.q(
        `SELECT count(*)::int active FROM place_domain WHERE domain='a.example' AND archived_at IS NULL`,
      )) as Array<{ active: number }>;
      expect(r[0].active).toBe(1);
      const total = (await tx.q(
        `SELECT count(*)::int n FROM place_domain WHERE domain='a.example'`,
      )) as Array<{ n: number }>;
      expect(total[0].n).toBe(2);
    });
  });

  it("un segundo place del mismo owner puede reusar un dominio archivado del primero", async () => {
    await inRlsTx(async (tx) => {
      const { uA, pidA } = await seedPlaceA(tx);
      const pidA2 = await seedSecondPlaceOwnedBy(tx, uA, "place-a2");
      await tx.as("authA");
      expect(
        await tx.denied(`INSERT INTO place_domain (place_id,domain) VALUES ($1,'a.example')`, [
          pidA2,
        ]),
      ).toBe(true);
      await tx.q(
        `UPDATE place_domain SET archived_at=now() WHERE place_id=$1 AND domain='a.example'`,
        [pidA],
      );
      expect(
        await tx.denied(`INSERT INTO place_domain (place_id,domain) VALUES ($1,'a.example')`, [
          pidA2,
        ]),
      ).toBe(false);
    });
  });
});

describe("S2 RLS — owner-only INSERT baseline (ADR-0012 §2)", () => {
  it("el owner SÍ inserta place_domain en su place", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedPlaceA(tx);
      await tx.as("authA");
      expect(
        await tx.denied(`INSERT INTO place_domain (place_id,domain) VALUES ($1,'a2.example')`, [
          pidA,
        ]),
      ).toBe(false);
    });
  });

  it("un no-owner (B) NO inserta place_domain en place ajeno", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedPlaceA(tx);
      await tx.as("authB");
      expect(
        await tx.denied(`INSERT INTO place_domain (place_id,domain) VALUES ($1,'z.example')`, [
          pidA,
        ]),
      ).toBe(true);
    });
  });

  // UPSERT: WITH CHECK rechaza la rama INSERT antes del conflict resolution.
  it("un no-owner (B) UPSERT (ON CONFLICT DO UPDATE) → DENIED por WITH CHECK", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedPlaceA(tx);
      await tx.as("authB");
      expect(
        await tx.denied(
          `INSERT INTO place_domain (place_id,domain) VALUES ($1,'a.example')
           ON CONFLICT (domain) WHERE archived_at IS NULL DO UPDATE SET verified_at = now()`,
          [pidA],
        ),
      ).toBe(true);
    });
  });
});

describe("S3 RLS — owner-only SELECT (ADR-0010/0012 §2)", () => {
  it("un no-owner (B) NO ve filas de place_domain (0 rows)", async () => {
    await inRlsTx(async (tx) => {
      await seedPlaceA(tx);
      await tx.as("authB");
      expect(await countDomains(tx)).toBe(0);
    });
  });

  // ADR-0021 (member-read) extiende SELECT de `place` + self-row de `membership`;
  // NO se extiende a `place_domain`. Si un refactor agrega `OR exists(membership)`
  // al predicado, este test rompe.
  it("un miembro activo NO ve place_domain (member-read NO se extiende a config técnica)", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pidA } = await seedPlaceA(tx);
      await joinAsMember(tx, uB, pidA);
      await tx.as("authB");
      expect(await countDomains(tx)).toBe(0);
    });
  });
});

describe("S4 RLS — owner-only UPDATE/DELETE matrix", () => {
  it("non-owner (B) UPDATE archived_at → 0 filas", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedPlaceA(tx);
      await tx.as("authB");
      expect(await affectedUpdate(tx, pidA, "archived_at = now()")).toBe(0);
    });
  });

  it("miembro UPDATE archived_at → 0 filas", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pidA } = await seedPlaceA(tx);
      await joinAsMember(tx, uB, pidA);
      await tx.as("authB");
      expect(await affectedUpdate(tx, pidA, "archived_at = now()")).toBe(0);
    });
  });

  it("owner UPDATE verified_at → 1 fila (control positivo)", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedPlaceA(tx);
      await tx.as("authA");
      expect(await affectedUpdate(tx, pidA, "verified_at = now()")).toBe(1);
    });
  });

  it("non-owner (B) DELETE → 0 filas", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedPlaceA(tx);
      await tx.as("authB");
      expect(await affectedDelete(tx, pidA)).toBe(0);
    });
  });

  it("miembro DELETE → 0 filas", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pidA } = await seedPlaceA(tx);
      await joinAsMember(tx, uB, pidA);
      await tx.as("authB");
      expect(await affectedDelete(tx, pidA)).toBe(0);
    });
  });

  it("owner DELETE → 1 fila (control positivo)", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedPlaceA(tx);
      await tx.as("authA");
      expect(await affectedDelete(tx, pidA)).toBe(1);
    });
  });
});

describe("S5 RLS — cross-place scoping", () => {
  it("owner de otro place NO ve/muta place_domain de place-a", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pidA } = await seedPlaceA(tx);
      await seedSecondPlaceOwnedBy(tx, uB, "place-x"); // B owner-real de otro place
      await tx.as("authB");
      expect(await countDomains(tx)).toBe(0);
      expect(await affectedUpdate(tx, pidA, "archived_at = now()")).toBe(0);
      expect(await affectedDelete(tx, pidA)).toBe(0);
    });
  });
});

describe("S6 RLS — anti-refactor edges (comportamiento intencional)", () => {
  it("el owner conserva acceso a filas archived_at NOT NULL (audit trail)", async () => {
    // Policy es agnóstica al archivado del row; queries de las Server Actions
    // filtran. Si un refactor agrega `AND archived_at IS NULL` al predicado
    // RLS, el owner pierde audit trail → este test bloquea ese refactor.
    await inRlsTx(async (tx) => {
      const { pidA, domainId } = await seedPlaceA(tx);
      await tx.as("authA");
      await tx.q(`UPDATE place_domain SET archived_at=now() WHERE id=$1`, [domainId]);
      const r = (await tx.q(
        `SELECT archived_at FROM place_domain WHERE place_id=$1`,
        [pidA],
      )) as Array<{ archived_at: Date | null }>;
      expect(r).toHaveLength(1);
      expect(r[0].archived_at).not.toBeNull();
      expect(await affectedDelete(tx, pidA)).toBe(1); // puede borrar definitivo
    });
  });

  it("el owner conserva acceso aunque place.archived_at NOT NULL (tombstone)", async () => {
    // Policy JOIN-ea place_ownership, NO place.archived_at. Si un refactor
    // agrega `AND p.archived_at IS NULL`, exige ADR explícito antes de mergear.
    await inRlsTx(async (tx) => {
      const { pidA } = await seedPlaceA(tx);
      await tx.seed(`UPDATE place SET archived_at=now() WHERE id=$1`, [pidA]); // tombstone
      await tx.as("authA");
      expect(await countDomains(tx)).toBe(1);
      expect(await affectedUpdate(tx, pidA, "archived_at = now()")).toBe(1);
    });
  });
});

describe("S7 RLS — structural drift defense", () => {
  it("pg_policies: place_domain_all es PERMISSIVE FOR ALL con USING == WITH CHECK", async () => {
    await inRlsTx(async (tx) => {
      const rows = (await tx.q(
        `SELECT polname, polpermissive, polcmd,
                pg_get_expr(polqual,polrelid) AS using_expr,
                pg_get_expr(polwithcheck,polrelid) AS check_expr
           FROM pg_policy WHERE polrelid = 'public.place_domain'::regclass`,
      )) as Array<{
        polname: string;
        polpermissive: boolean;
        polcmd: string;
        using_expr: string;
        check_expr: string;
      }>;
      expect(rows).toHaveLength(1);
      const p = rows[0];
      expect(p.polname).toBe("place_domain_all");
      expect(p.polpermissive).toBe(true);
      expect(p.polcmd).toBe("*"); // pg_policy: '*' == FOR ALL
      expect(p.using_expr).toBe(p.check_expr);
      expect(p.using_expr).toMatch(/place_ownership/);
      expect(p.using_expr).toMatch(/app_user/);
      expect(p.using_expr).toMatch(/app\.current_user_id/);
    });
  });

  it("pg_roles: app_system NO tiene BYPASSRLS (defense in depth)", async () => {
    await inRlsTx(async (tx) => {
      const rows = (await tx.q(
        `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app_system'`,
      )) as Array<{ rolbypassrls: boolean }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].rolbypassrls).toBe(false);
    });
  });
});
