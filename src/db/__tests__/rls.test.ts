import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";

// S2: RLS por-operación (ADR-0010 refinado por ADR-0012). Aislamiento por
// place enforceado en el motor. Se asierta bajo `app_system` (rol real, sin
// BYPASSRLS) con claims inyectados — NUNCA el rol admin (falso verde, ver
// CLAUDE.md / tests.md). El escenario se siembra como dueño (RLS no aplica al
// dueño de la tabla; en runtime sólo lo crearía `app.create_place`).

afterAll(() => endRlsAdminPool());

// A es owner de place-a; B es un usuario autenticado sin relación con place-a.
async function seedPlaceA(tx: RlsTx) {
  const [{ id: uA }] = (await tx.seed(
    `INSERT INTO app_user (auth_user_id,email,display_name,handle)
     VALUES ('authA','a@x.com','A','handle_a') RETURNING id`,
  )) as Array<{ id: string }>;
  const [{ id: uB }] = (await tx.seed(
    `INSERT INTO app_user (auth_user_id,email,display_name,handle)
     VALUES ('authB','b@x.com','B','handle_b') RETURNING id`,
  )) as Array<{ id: string }>;
  const [{ id: pid }] = (await tx.seed(
    `INSERT INTO place (slug,name,billing_mode)
     VALUES ('place-a','Place A','OWNER_PAYS') RETURNING id`,
  )) as Array<{ id: string }>;
  await tx.seed(`INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`, [uA, pid]);
  await tx.seed(`INSERT INTO membership (user_id,place_id) VALUES ($1,$2)`, [uA, pid]);
  await tx.seed(
    `INSERT INTO invitation (place_id,email,invited_by,expires_at,token)
     VALUES ($1,'inv@x.com','A',now()+interval '7 days','tokA')`,
    [pid],
  );
  await tx.seed(`INSERT INTO place_domain (place_id,domain) VALUES ($1,'a.example')`, [pid]);
  return { uA, uB, pid };
}

const count = async (tx: RlsTx, table: string) =>
  Number(((await tx.q(`SELECT count(*)::int n FROM ${table}`)) as Array<{ n: number }>)[0].n);

const PLACE_TABLES = ["place", "place_ownership", "membership", "invitation", "place_domain"] as const;

describe("S2 RLS — aislamiento por place (ADR-0010/0012)", () => {
  it("el owner ve exactamente las filas de su place, sin recursión", async () => {
    await inRlsTx(async (tx) => {
      await seedPlaceA(tx);
      await tx.as("authA");
      // place/membership/invitation/place_domain sub-consultan place_ownership;
      // si el fraseo no fuese recursion-safe esto lanzaría `infinite recursion`.
      for (const t of PLACE_TABLES) expect(await count(tx, t)).toBe(1);
      expect(await count(tx, "app_user")).toBe(1); // sólo su propia fila
    });
  });

  it("un usuario ajeno (B) no ve ninguna fila del place de A", async () => {
    await inRlsTx(async (tx) => {
      await seedPlaceA(tx);
      await tx.as("authB");
      for (const t of PLACE_TABLES) expect(await count(tx, t)).toBe(0);
      expect(await count(tx, "app_user")).toBe(1); // sólo la propia (B)
    });
  });

  it("app_user es self-only: B no puede UPDATE la fila de A", async () => {
    await inRlsTx(async (tx) => {
      await seedPlaceA(tx);
      await tx.as("authB");
      const r = (await tx.q(
        `UPDATE app_user SET display_name='hacked' WHERE auth_user_id='authA'`,
      )) as unknown as { length: number };
      expect(await count(tx, "app_user")).toBe(1);
      expect(Array.isArray(r) ? r.length : 0).toBe(0); // no tocó la fila de A
    });
  });

  it("B no puede UPDATE/DELETE el place ajeno (0 filas afectadas)", async () => {
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlaceA(tx);
      await tx.as("authB");
      await tx.q(`UPDATE place SET name='hacked' WHERE id=$1`, [pid]);
      await tx.q(`DELETE FROM place WHERE id=$1`, [pid]);
      await tx.as("authA");
      const [{ name }] = (await tx.q(`SELECT name FROM place WHERE id=$1`, [pid])) as Array<{
        name: string;
      }>;
      expect(name).toBe("Place A"); // intacto
    });
  });

  it("sin claim no se ve ninguna fila (la policy deniega)", async () => {
    await inRlsTx(async (tx) => {
      await seedPlaceA(tx);
      await tx.as(null);
      expect(await count(tx, "place")).toBe(0);
      expect(await count(tx, "app_user")).toBe(0);
    });
  });
});

describe("S2 RLS — INSERT de creación DENEGADO (ADR-0012 §1)", () => {
  it("INSERT directo a place/place_ownership/membership es rechazado", async () => {
    await inRlsTx(async (tx) => {
      const { uA, pid } = await seedPlaceA(tx);
      await tx.as("authA"); // incluso el owner: la creación va por la función
      expect(
        await tx.denied(`INSERT INTO place (slug,name,billing_mode) VALUES ('p2','P2','OWNER_PAYS')`),
      ).toBe(true);
      expect(
        await tx.denied(`INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`, [uA, pid]),
      ).toBe(true);
      expect(
        await tx.denied(`INSERT INTO membership (user_id,place_id) VALUES ($1,$2)`, [uA, pid]),
      ).toBe(true);
    });
  });

  it("EL HUECO CERRADO: B no puede autoasignarse ownership del place de A", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pid } = await seedPlaceA(tx);
      await tx.as("authB");
      expect(
        await tx.denied(`INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`, [uB, pid]),
      ).toBe(true);
    });
  });
});

// S4 RLS — member-read (ADR-0021): el patrón canónico extiende `_sel` con
// `OR exists(membership activa)`. Habilita que un miembro vea el place al que
// pertenece + su propia row de membership. INSERT/UPDATE/DELETE siguen owner-
// only (los miembros sólo ganan SELECT). Tests TDD-first: 1 y 3 fallan antes
// de la migration 0004_member_read.sql; 2 y 4 ya verdes pre/post para
// cobertura del comportamiento esperado de left_at y mixto owner+member.

async function makeMember(tx: RlsTx, userId: string, placeId: string, leftAt?: "now") {
  if (leftAt === "now") {
    await tx.seed(
      `INSERT INTO membership (user_id, place_id, left_at) VALUES ($1, $2, now())`,
      [userId, placeId],
    );
  } else {
    await tx.seed(`INSERT INTO membership (user_id, place_id) VALUES ($1, $2)`, [userId, placeId]);
  }
}

describe("S4 RLS — member-read (ADR-0021)", () => {
  it("un miembro activo VE el place donde es miembro (cubre la regla nueva)", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pid } = await seedPlaceA(tx);
      await makeMember(tx, uB, pid); // B se une a place A como miembro (no owner)
      await tx.as("authB");
      // El miembro ahora ve la fila del place (gracias al OR de place_sel).
      const rows = (await tx.q(`SELECT name FROM place WHERE id=$1`, [pid])) as Array<{
        name: string;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Place A");
    });
  });

  it("un miembro que se fue (left_at NOT NULL) NO ve el place", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pid } = await seedPlaceA(tx);
      await makeMember(tx, uB, pid, "now"); // B se unió y se fue (left_at set)
      await tx.as("authB");
      expect(await count(tx, "place")).toBe(0);
    });
  });

  it("un miembro VE su propia row de membership; NO ve la de otros miembros", async () => {
    await inRlsTx(async (tx) => {
      const { uA, uB, pid } = await seedPlaceA(tx);
      await makeMember(tx, uB, pid); // ahora hay 2 filas en membership: uA, uB
      await tx.as("authB");
      // B ve sólo su propia row (no la de A — ese predicado es self por ADR-0021).
      const rows = (await tx.q(
        `SELECT user_id FROM membership WHERE place_id=$1 ORDER BY user_id`,
        [pid],
      )) as Array<{ user_id: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(uB);
      // explícito: la row de uA NO está visible para B.
      expect(rows.find((r) => r.user_id === uA)).toBeUndefined();
    });
  });

  it("mixto: user owner de un place + miembro de otro VE ambos places", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pid: pidA } = await seedPlaceA(tx);
      // uB es owner de un segundo place pB; además es miembro de pA.
      const [{ id: pidB }] = (await tx.seed(
        `INSERT INTO place (slug,name,billing_mode)
         VALUES ('place-b','Place B','OWNER_PAYS') RETURNING id`,
      )) as Array<{ id: string }>;
      await tx.seed(`INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`, [uB, pidB]);
      await tx.seed(`INSERT INTO membership (user_id,place_id) VALUES ($1,$2)`, [uB, pidB]);
      await makeMember(tx, uB, pidA); // y miembro de A
      await tx.as("authB");
      // B ve 2 places: pA (como member) + pB (como owner).
      const rows = (await tx.q(`SELECT id, name FROM place ORDER BY name`)) as Array<{
        id: string;
        name: string;
      }>;
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.id).sort()).toEqual([pidA, pidB].sort());
    });
  });
});

// ADR-0026 (2026-05-21): el partial unique `(domain) WHERE archived_at IS NULL`
// libera el dominio cuando la fila se archiva — el mismo valor de dominio
// puede volver a registrarse, ya sea por el mismo place (re-vincular tras
// remover) o por otro place del mismo owner (cambio de marca). Esta sección
// asierta el behavior bajo el rol real `app_system` con claim del owner, no
// bajo el rol admin: la UNIQUE violation se mapea a `domain_taken` en la
// Server Action (S3), por eso acá importa que el motor PG la rechace cuando
// hay colisión activa y la deje pasar cuando no.
describe("S1 RLS — partial unique permite reuso post-archive (ADR-0026)", () => {
  it("mientras hay una fila activa con el mismo dominio, el INSERT duplicado falla (UNIQUE)", async () => {
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlaceA(tx); // ya hay place_domain activo: a.example
      await tx.as("authA");
      expect(
        await tx.denied(
          `INSERT INTO place_domain (place_id, domain) VALUES ($1, 'a.example')`,
          [pid],
        ),
      ).toBe(true);
    });
  });

  it("tras archivar la fila, el mismo dominio puede re-registrarse en el mismo place", async () => {
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlaceA(tx); // a.example activo
      await tx.as("authA");
      // archive (soft delete) — owner-only UPDATE.
      await tx.q(
        `UPDATE place_domain SET archived_at = now()
         WHERE place_id = $1 AND domain = 'a.example'`,
        [pid],
      );
      // re-INSERT del mismo dominio. Usar `tx.q` directo (NO `tx.denied`):
      // `denied` envuelve en SAVEPOINT y ROLLBACK siempre, por lo que la
      // fila no quedaría persistida en la tx y el sanity-check de abajo
      // vería 0 activas. Acá queremos que el insert persista para luego
      // asertar el invariante; si el motor lo rechazara, `tx.q` lanza y
      // el test falla con la stack de la query.
      await tx.q(
        `INSERT INTO place_domain (place_id, domain) VALUES ($1, 'a.example')`,
        [pid],
      );
      // Invariante: hay exactamente 1 fila ACTIVA con ese dominio (la
      // archivada queda en la tabla pero no cuenta para el partial unique).
      const r = (await tx.q(
        `SELECT count(*)::int AS active
         FROM place_domain WHERE domain = 'a.example' AND archived_at IS NULL`,
      )) as Array<{ active: number }>;
      expect(r[0].active).toBe(1);
      // Sanity adicional: hay 2 filas en total (1 archivada + 1 activa).
      const total = (await tx.q(
        `SELECT count(*)::int AS n FROM place_domain WHERE domain = 'a.example'`,
      )) as Array<{ n: number }>;
      expect(total[0].n).toBe(2);
    });
  });

  it("un segundo place del mismo owner puede reusar un dominio archivado del primero", async () => {
    await inRlsTx(async (tx) => {
      const { uA, pid: pidA } = await seedPlaceA(tx); // a.example activo en pidA
      // Sembrar un segundo place también de A (INSERT directo está REVOKEd en
      // runtime, pero `seed` corre como dueño de tabla — equivale al efecto
      // que tendría `app.create_place` para el caller A).
      const [{ id: pidA2 }] = (await tx.seed(
        `INSERT INTO place (slug, name, billing_mode)
         VALUES ('place-a2', 'Place A2', 'OWNER_PAYS') RETURNING id`,
      )) as Array<{ id: string }>;
      await tx.seed(
        `INSERT INTO place_ownership (user_id, place_id) VALUES ($1, $2)`,
        [uA, pidA2],
      );
      await tx.as("authA");
      // Mientras a.example sigue activo en pidA, pidA2 NO lo puede registrar.
      expect(
        await tx.denied(
          `INSERT INTO place_domain (place_id, domain) VALUES ($1, 'a.example')`,
          [pidA2],
        ),
      ).toBe(true);
      // Archivamos en pidA (libera el dominio):
      await tx.q(
        `UPDATE place_domain SET archived_at = now()
         WHERE place_id = $1 AND domain = 'a.example'`,
        [pidA],
      );
      // Ahora pidA2 sí puede tomarlo.
      expect(
        await tx.denied(
          `INSERT INTO place_domain (place_id, domain) VALUES ($1, 'a.example')`,
          [pidA2],
        ),
      ).toBe(false);
    });
  });
});

describe("S2 RLS — invitation / place_domain owner-only (ADR-0012 §2)", () => {
  it("el owner SÍ inserta invitation/place_domain de su place", async () => {
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlaceA(tx);
      await tx.as("authA");
      expect(
        await tx.denied(
          `INSERT INTO invitation (place_id,email,invited_by,expires_at,token)
           VALUES ($1,'i2@x.com','A',now()+interval '7 days','tokA2')`,
          [pid],
        ),
      ).toBe(false);
      expect(
        await tx.denied(`INSERT INTO place_domain (place_id,domain) VALUES ($1,'a2.example')`, [pid]),
      ).toBe(false);
    });
  });

  it("un no-owner (B) NO inserta invitation/place_domain en place ajeno", async () => {
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlaceA(tx);
      await tx.as("authB");
      expect(
        await tx.denied(
          `INSERT INTO invitation (place_id,email,invited_by,expires_at,token)
           VALUES ($1,'z@x.com','B',now()+interval '7 days','tokZ')`,
          [pid],
        ),
      ).toBe(true);
      expect(
        await tx.denied(`INSERT INTO place_domain (place_id,domain) VALUES ($1,'z.example')`, [pid]),
      ).toBe(true);
    });
  });
});
