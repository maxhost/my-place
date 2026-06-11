import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";

// Feature D · S1 (ADR-0035 §3 + §4, 2026-05-24) — refactor RLS `place_ownership`:
// 3 policies SELF (`po_sel`/`po_upd`/`po_del`) → única `po_sel` via helper
// `app.current_user_owns_place` SECURITY DEFINER (anti-recursión); INSERT/
// UPDATE/DELETE REVOKE explícito a `app_system`. Además: `place.founder_user_id
// text NOT NULL` post back-fill determinístico.
//
// Post-ADR-0054 (single-owner, migration 0029): las 3 DEFINERs de mutación
// multi-owner (`elevate_to_owner`/`revoke_ownership`/`transfer_founder_
// ownership`) fueron DROPPED; el único writer de `place_ownership` es
// `app.create_place` y el invariante "un place = un owner" se enforcea con el
// UNIQUE index `place_ownership_place_id_unq` (ver describe final). El
// escenario canónico es por eso single-owner: uA owner de pA (uB miembro
// no-owner), uC owner de pB.
//
// Patrón seed-as-owner / assert-as-`app_system` (precedente
// `rls-place-domain.test.ts`, `consume-sso-jti.test.ts`); ROLLBACK siempre.

afterAll(() => endRlsAdminPool());

const APP_USER = `INSERT INTO app_user (auth_user_id,email,display_name,handle)
                  VALUES ($1,$2,'X',$3) RETURNING id`;
// Post-0012: `place.founder_user_id` es NOT NULL — el seed lo pasa explícito
// (el rol admin BYPASSRLS pero NO bypassa NOT NULL). En runtime lo setea
// `app.create_place` (refactor S5).
const PLACE = `INSERT INTO place (slug,name,billing_mode,founder_user_id)
               VALUES ($1,$2,'OWNER_PAYS',$3) RETURNING id`;

// Escenario canónico single-owner (ADR-0054): 2 places (A, B) + 3 users
// (A founder+owner único de pA, B miembro activo no-owner de pA; C
// founder+owner único de pB).
async function seedScenario(tx: RlsTx) {
  const [{ id: uA }] = (await tx.seed(APP_USER, ["authA", "a@x.com", "h_a"])) as Array<{ id: string }>;
  const [{ id: uB }] = (await tx.seed(APP_USER, ["authB", "b@x.com", "h_b"])) as Array<{ id: string }>;
  const [{ id: uC }] = (await tx.seed(APP_USER, ["authC", "c@x.com", "h_c"])) as Array<{ id: string }>;
  const [{ id: pidA }] = (await tx.seed(PLACE, ["place-a", "Place A", uA])) as Array<{ id: string }>;
  await tx.seed(
    `INSERT INTO place_ownership (user_id,place_id,granted_at)
     VALUES ($1,$2, now() - interval '1 hour')`,
    [uA, pidA],
  );
  await tx.seed(`INSERT INTO membership (user_id,place_id) VALUES ($1,$2)`, [uB, pidA]);
  const [{ id: pidB }] = (await tx.seed(PLACE, ["place-b", "Place B", uC])) as Array<{ id: string }>;
  await tx.seed(`INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`, [uC, pidB]);
  return { uA, uB, uC, pidA, pidB };
}

const countOwnerships = async (tx: RlsTx, pid: string) =>
  ((await tx.q(`SELECT count(*)::int n FROM place_ownership WHERE place_id=$1`, [pid])) as Array<{ n: number }>)[0].n;

describe("S1 RLS `place_ownership` — back-fill + NOT NULL founder", () => {
  // T1: el back-fill canónico (`MIN(granted_at).user_id` per place) ya corrió en
  // la migration 0012; re-correrlo en cualquier punto del lifecycle es no-op
  // sobre los datos (idempotente). Post-ADR-0054 hay una sola fila de ownership
  // por place → el MIN es trivial, pero la propiedad (re-run no cambia founder)
  // sigue siendo la defensa contra UPDATEs manuales fuera de `app.create_place`.
  it("back-fill MIN(granted_at) es determinístico e idempotente (no-op si re-corre)", async () => {
    await inRlsTx(async (tx) => {
      const { uA, pidA } = await seedScenario(tx);
      // El seed setea founder = uA explícito; re-corre el back-fill literal de
      // la migration 0012 y verifica que NO cambia (uA es el único owner).
      await tx.seed(
        `UPDATE place p SET founder_user_id = (
           SELECT po.user_id FROM place_ownership po
           WHERE po.place_id = p.id
           ORDER BY po.granted_at ASC LIMIT 1
         ) WHERE p.id = $1`,
        [pidA],
      );
      const [r1] = (await tx.seed(`SELECT founder_user_id FROM place WHERE id=$1`, [pidA])) as Array<{
        founder_user_id: string;
      }>;
      expect(r1.founder_user_id).toBe(uA);
      // Segunda corrida — idempotente.
      await tx.seed(
        `UPDATE place p SET founder_user_id = (
           SELECT po.user_id FROM place_ownership po
           WHERE po.place_id = p.id
           ORDER BY po.granted_at ASC LIMIT 1
         ) WHERE p.id = $1`,
        [pidA],
      );
      const [r2] = (await tx.seed(`SELECT founder_user_id FROM place WHERE id=$1`, [pidA])) as Array<{
        founder_user_id: string;
      }>;
      expect(r2.founder_user_id).toBe(uA);
    });
  });

  // T2: `place.founder_user_id NOT NULL` post-migration → INSERT sin la columna
  // (intentado como rol admin bypassando RLS) explota con `23502`. Defensa
  // contra cualquier path futuro que cree places sin pasar por `app.create_place`.
  it("place.founder_user_id NOT NULL: INSERT sin la columna → 23502 not_null_violation", async () => {
    await inRlsTx(async (tx) => {
      // Rol admin (RESET ROLE implícito en `seed`): tiene BYPASSRLS y privileges
      // de INSERT — pero el NOT NULL del schema aplica universal.
      let code: string | null = null;
      try {
        await tx.seed(
          `INSERT INTO place (slug,name,billing_mode) VALUES ('no-founder','X','OWNER_PAYS')`,
        );
      } catch (e) {
        code = (e as { code?: string }).code ?? null;
      }
      expect(code).toBe("23502");
    });
  });
});

describe("S1 RLS `place_ownership` — po_sel owner-of-place via helper DEFINER", () => {
  // T3: el owner del place ve su fila de ownership; un miembro no-owner del
  // mismo place no ve ninguna (la policy `po_sel` gatea por ownership, no por
  // membership). Post-ADR-0054 la lista de owners es siempre 1.
  it("owner ve la fila de ownership del place; miembro no-owner ve 0", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authA");
      expect(await countOwnerships(tx, pidA)).toBe(1); // uA, único owner
      await tx.as("authB"); // miembro activo de pA, no owner
      expect(await countOwnerships(tx, pidA)).toBe(0);
    });
  });

  // T4: visitor sin ownership del place no ve filas — zero leak.
  it("no-owner ve 0 filas del place ajeno", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authC"); // C es owner sólo de pidB
      expect(await countOwnerships(tx, pidA)).toBe(0);
    });
  });

  // T5: cross-place scoping — owner de pA no ve ownership de pB (donde no es
  // owner). Regresión: si el predicado se relaja a `EXISTS (ownership cualquier
  // place)`, este test rompe.
  it("cross-place: owner de place-a no ve filas de ownership de place-b", async () => {
    await inRlsTx(async (tx) => {
      const { pidB } = await seedScenario(tx);
      await tx.as("authA"); // A es owner sólo de pA
      expect(await countOwnerships(tx, pidB)).toBe(0);
    });
  });
});

describe("S1 RLS `place_ownership` — REVOKE INSERT/UPDATE/DELETE directo", () => {
  // T6-T8: defense-in-depth WORM (ADR-0035 §4, reducido por ADR-0054). Toda
  // escritura pasa por `app.create_place` (único writer post-0029). Sin estos
  // REVOKE, un drift futuro podría hacer INSERT/UPDATE/DELETE directo y
  // bypassar el invariante single-owner.
  it("INSERT directo a place_ownership → permission denied", async () => {
    await inRlsTx(async (tx) => {
      const { uC, pidA } = await seedScenario(tx);
      await tx.as("authA");
      expect(
        await tx.denied(
          `INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`,
          [uC, pidA],
        ),
      ).toBe(true);
    });
  });

  it("UPDATE directo a place_ownership → permission denied", async () => {
    await inRlsTx(async (tx) => {
      const { uA, pidA } = await seedScenario(tx);
      await tx.as("authA");
      expect(
        await tx.denied(
          `UPDATE place_ownership SET granted_at = now() WHERE place_id=$1 AND user_id=$2`,
          [pidA, uA],
        ),
      ).toBe(true);
    });
  });

  it("DELETE directo a place_ownership → permission denied", async () => {
    await inRlsTx(async (tx) => {
      const { uA, pidA } = await seedScenario(tx);
      await tx.as("authA");
      expect(
        await tx.denied(`DELETE FROM place_ownership WHERE place_id=$1 AND user_id=$2`, [
          pidA,
          uA,
        ]),
      ).toBe(true);
    });
  });
});

describe("S1 RLS `place_ownership` — structural drift defense", () => {
  // T9: pg_policy enumera lo que existe sobre la tabla. Post-S1 sólo `po_sel`;
  // las viejas `po_upd`/`po_del` desaparecieron (DROP). Si un refactor futuro
  // re-introduce policies de mutación, este test rompe y exige ADR explícita.
  it("pg_policy: sólo po_sel existe en place_ownership (po_upd/po_del DROPPED)", async () => {
    await inRlsTx(async (tx) => {
      const rows = (await tx.q(
        `SELECT polname, polcmd, pg_get_expr(polqual,polrelid) AS using_expr
           FROM pg_policy WHERE polrelid = 'public.place_ownership'::regclass
           ORDER BY polname`,
      )) as Array<{ polname: string; polcmd: string; using_expr: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].polname).toBe("po_sel");
      expect(rows[0].polcmd).toBe("r"); // 'r' = SELECT en pg_policy.polcmd
      expect(rows[0].using_expr).toMatch(/current_user_owns_place/);
    });
  });

  // T10: pg_proc registra metadata de la función — verifica que se creó con
  // SECURITY DEFINER + STABLE. Drift del LANGUAGE / VOLATILE rompería tests
  // o introduciría caching incorrecto.
  it("pg_proc: app.current_user_owns_place(text) → SECURITY DEFINER + STABLE", async () => {
    await inRlsTx(async (tx) => {
      const [meta] = (await tx.seed(
        `SELECT
           pg_get_function_result(p.oid)        AS return_type,
           p.provolatile                        AS volatile_kind,
           p.prosecdef                          AS security_definer
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'app' AND p.proname = 'current_user_owns_place'`,
      )) as Array<{ return_type: string; volatile_kind: string; security_definer: boolean }>;
      expect(meta.return_type).toBe("boolean");
      expect(meta.volatile_kind).toBe("s"); // 's' = STABLE
      expect(meta.security_definer).toBe(true);
    });
  });

  // T11: EXECUTE solo a `app_system`, denegado a PUBLIC. Mismo invariante que
  // app.create_place / app.consume_sso_jti — la función nunca es invocable por
  // un rol no previsto.
  it("ACL: EXECUTE on app.current_user_owns_place(text) → app_system=true / public=false", async () => {
    await inRlsTx(async (tx) => {
      const sig = "app.current_user_owns_place(text)";
      const [acl] = (await tx.seed(
        `SELECT has_function_privilege('app_system', $1, 'EXECUTE') AS sys,
                has_function_privilege('public',     $1, 'EXECUTE') AS pub`,
        [sig],
      )) as Array<{ sys: boolean; pub: boolean }>;
      expect(acl.sys).toBe(true);
      expect(acl.pub).toBe(false);
    });
  });
});

describe("S1 RLS `place_ownership` — helper app.current_user_owns_place behaviour", () => {
  // T12: caller real owner → true. Path happy del helper.
  it("happy: caller owner del place → true", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as("authA");
      const [r] = (await tx.q(
        `SELECT app.current_user_owns_place($1) AS owns`,
        [pidA],
      )) as Array<{ owns: boolean }>;
      expect(r.owns).toBe(true);
    });
  });

  // T13: caller no-owner → false (no throw). El predicado de RLS necesita
  // booleano puro; throw rompería la query del SELECT y daría "permission
  // denied" en vez de "0 rows".
  it("denial: caller no-owner del place → false (no throw)", async () => {
    await inRlsTx(async (tx) => {
      const { pidB } = await seedScenario(tx);
      await tx.as("authA"); // A NO es owner de pB
      const [r] = (await tx.q(
        `SELECT app.current_user_owns_place($1) AS owns`,
        [pidB],
      )) as Array<{ owns: boolean }>;
      expect(r.owns).toBe(false);
    });
  });

  // T14: caller anonymous (claim vacío) → false sin throw. Defensa contra
  // visitors sin sesión que pasen por código que invoque la función — debe
  // null-safe degradar a false, no romper.
  it("anonymous: claim vacío (sin sub) → false sin throw (null-safe)", async () => {
    await inRlsTx(async (tx) => {
      const { pidA } = await seedScenario(tx);
      await tx.as(null);
      const [r] = (await tx.q(
        `SELECT app.current_user_owns_place($1) AS owns`,
        [pidA],
      )) as Array<{ owns: boolean }>;
      expect(r.owns).toBe(false);
    });
  });
});

describe("Single-owner (ADR-0054, migration 0029) — UNIQUE place_ownership(place_id)", () => {
  // T15: el invariante nuevo. Insertar un SEGUNDO owner para el mismo place
  // falla con `23505 unique_violation` aun como rol admin (los constraints/
  // unique indexes aplican universal, a diferencia de RLS). Esto reemplaza la
  // convención multi-owner de ADR-0035 por un invariante estructural: ningún
  // bug futuro puede crear co-owners.
  it("INSERT de segundo owner para el mismo place → 23505 unique_violation (aun como admin)", async () => {
    await inRlsTx(async (tx) => {
      const { uB, pidA } = await seedScenario(tx);
      let code: string | null = null;
      try {
        await tx.seed(
          `INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`,
          [uB, pidA],
        );
      } catch (e) {
        code = (e as { code?: string }).code ?? null;
      }
      expect(code).toBe("23505");
    });
  });

  // T16: structural drift defense — el UNIQUE index existe con el nombre
  // canónico y es unique de verdad. Si una migration futura lo dropea sin ADR,
  // este test rompe.
  it("pg_index: place_ownership_place_id_unq existe y es UNIQUE", async () => {
    await inRlsTx(async (tx) => {
      const rows = (await tx.seed(
        `SELECT i.indisunique AS is_unique
           FROM pg_class c
           JOIN pg_index i ON i.indexrelid = c.oid
          WHERE c.relname = 'place_ownership_place_id_unq'`,
      )) as Array<{ is_unique: boolean }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].is_unique).toBe(true);
    });
  });

  // T17: las 3 DEFINERs multi-owner de Feature D ya no existen (DROPPED en
  // 0029). Si reaparecen (re-apply accidental de 0014/0015/0016 o copy-paste
  // de un branch viejo), este test rompe y exige ADR nueva (ADR-0054 §5).
  it("pg_proc: elevate_to_owner / revoke_ownership / transfer_founder_ownership NO existen", async () => {
    await inRlsTx(async (tx) => {
      const rows = (await tx.seed(
        `SELECT p.proname
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'app'
            AND p.proname IN ('elevate_to_owner','revoke_ownership','transfer_founder_ownership')`,
      )) as Array<{ proname: string }>;
      expect(rows).toHaveLength(0);
    });
  });
});
