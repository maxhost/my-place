import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";

// Feature E · Invite Accept Flow V1.2 Sesión D.fix (ADR-0046 §"Addendum
// operacional — Sesión D", migration 0023) — `app.lookup_user_email_by_id
// (uuid)` SECURITY DEFINER. Canal anonymous-safe que el helper
// `getCurrentUserEmailForRequest` (`shared/lib/current-user-email.ts`)
// consume via `getAuthenticatedDbForRequest` (ADR-0034 coordinator) para
// resolver el email del user logueado zone-aware (apex via Neon Auth SDK
// cookie cross-subdomain + custom domain via SSO local cookie). GRANT
// específico (id, email) — defense-in-depth: el DEFINER no expone banned,
// role, image, emailVerified, createdAt.
//
// Espejo de los tests de 0022 (`lookup-custom-domain-by-slug.test.ts`):
// seed-as-owner via `neon_auth.user` INSERT, luego se baja a `app_system`
// con claim vacío (caller anonymous-like, paralelo al RSC pre-mintaje de
// cookie SSO local) e invoca la función. ROLLBACK siempre — cero footprint
// en `test` (las filas insertadas en `neon_auth.user` se revierten).

afterAll(() => endRlsAdminPool());

// Sembra un user fresco en `neon_auth.user` (managed por Neon Auth en
// producción; en test podemos INSERT directo como dueño dentro del TX que
// hará ROLLBACK). Retorna `id` (uuid generado por DEFAULT del schema Neon
// Auth o por nosotros si no hay DEFAULT). Campos NOT NULL: id, name, email,
// emailVerified, createdAt, updatedAt — todos seedeados explícitamente.
async function seedUser(
  tx: RlsTx,
  opts: { email?: string; name?: string } = {},
): Promise<{ id: string; email: string }> {
  const email = opts.email ?? `seed-${Math.random().toString(36).slice(2, 10)}@x.com`;
  const name = opts.name ?? "Seed User";
  const [{ id }] = (await tx.seed(
    `INSERT INTO neon_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, true, now(), now()) RETURNING id`,
    [name, email],
  )) as Array<{ id: string }>;
  return { id, email };
}

// Helper: invoca la función como caller anonymous-like (claim vacío). Paralelo
// al RSC del invite page post-SSO-chain (antes de leer la cookie SSO local
// el RSC corre como `app_system` sin claim, pero el coordinator ADR-0034 le
// pasará claims.sub al callback que invoca este lookup).
async function lookupAsAnonymous(
  tx: RlsTx,
  id: string,
): Promise<string | null> {
  await tx.as(null);
  const rows = (await tx.q(
    `SELECT app.lookup_user_email_by_id($1::uuid) AS email`,
    [id],
  )) as Array<{ email: string | null }>;
  return rows[0].email;
}

describe("Sesión D.fix app.lookup_user_email_by_id — DEFINER anonymous lookup (ADR-0046 §Addendum Sesión D)", () => {
  it("happy path: id de user existente → retorna el `email` text", async () => {
    await inRlsTx(async (tx) => {
      const { id, email } = await seedUser(tx, {
        email: "happy@nocodecompany.co",
      });
      const result = await lookupAsAnonymous(tx, id);
      expect(result).toBe(email);
    });
  });

  it("id inexistente (UUID válido pero no en la tabla) → NULL", async () => {
    await inRlsTx(async (tx) => {
      // UUID arbitrario que no matchea ningún user seeded.
      const result = await lookupAsAnonymous(
        tx,
        "00000000-0000-0000-0000-000000000000",
      );
      expect(result).toBeNull();
    });
  });

  it("DEFINER bypass: caller `app_system` sin claim recibe el email", async () => {
    // Clave de seguridad del pattern: el RSC del invite flow post-SSO-chain
    // corre bajo `app_system`. Sin DEFINER, SELECT directo sobre
    // `neon_auth.user` da permission denied (zero GRANTs para app_system).
    // Con DEFINER, el dueño de la función (`neondb_owner`, BYPASSRLS + GRANT
    // implícito por ownership administrativo) hace el SELECT por el caller —
    // el caller mantiene rol `app_system` sin claim, pero ve el email.
    await inRlsTx(async (tx) => {
      const { id, email } = await seedUser(tx, {
        email: "definer@test.co",
      });
      await tx.as(null);
      const [whoami] = (await tx.q(
        `SELECT current_user AS role, nullif(current_setting('request.jwt.claims', true), '') AS claims`,
      )) as Array<{ role: string; claims: string | null }>;
      expect(whoami.role).toBe("app_system");
      expect(whoami.claims).toBeNull();
      const rows = (await tx.q(
        `SELECT app.lookup_user_email_by_id($1::uuid) AS email`,
        [id],
      )) as Array<{ email: string | null }>;
      expect(rows[0].email).toBe(email);
    });
  });

  it("GRANTs regression: SELECT directo sobre neon_auth.user SIN DEFINER (caller anónimo) → permission denied", async () => {
    // Verifica que el DEFINER NO debilitó la base. SELECT directo (sin la
    // función `app.lookup_user_email_by_id`) corre bajo el rol del caller
    // (`app_system`) que NO tiene GRANTs sobre `neon_auth.user` (verificado
    // empíricamente 2026-05-27). El intento debe ser rechazado.
    await inRlsTx(async (tx) => {
      await seedUser(tx, { email: "grants@test.co" });
      await tx.as(null);
      const denied = await tx.denied(
        `SELECT email FROM neon_auth."user" LIMIT 1`,
      );
      expect(denied).toBe(true);
    });
  });

  it("LIMIT 1 defense-in-depth: shape escalar (no array)", async () => {
    // `neon_auth.user.id` es PRIMARY KEY → ≤1 fila por id garantizado por
    // constraint. LIMIT 1 = defense-in-depth redundante explícito. Verifica
    // que el retorno es escalar (string), no array.
    await inRlsTx(async (tx) => {
      const { id } = await seedUser(tx, { email: "scalar@test.co" });
      const rows = (await tx.q(
        `SELECT app.lookup_user_email_by_id($1::uuid) AS email`,
        [id],
      )) as Array<{ email: unknown }>;
      expect(typeof rows[0].email).toBe("string");
      expect(Array.isArray(rows[0].email)).toBe(false);
    });
  });

  it("payload mínimo: retorna SÓLO email, no jsonb con metadata extra", async () => {
    // Contrato canónico: text escalar (no jsonb con id, name, emailVerified,
    // role, banned, etc.) — paralelo a 0010/0022. El caller obtiene SOLO el
    // email; cero leak adicional sobre el user.
    await inRlsTx(async (tx) => {
      const { id, email } = await seedUser(tx, { email: "shape@test.co" });
      const rows = (await tx.q(
        `SELECT app.lookup_user_email_by_id($1::uuid) AS payload`,
        [id],
      )) as Array<{ payload: unknown }>;
      expect(typeof rows[0].payload).toBe("string");
      expect(rows[0].payload).toBe(email);
    });
  });

  it("aislamiento: lookup de id_A NO retorna email de user_B (mismatch defense)", async () => {
    // Verifica que el WHERE id = p_id matchea por igualdad estricta — un
    // lookup con id_A nunca retorna email del user_B aunque sus IDs sean
    // visualmente similares.
    await inRlsTx(async (tx) => {
      const userA = await seedUser(tx, { email: "alice@test.co" });
      const userB = await seedUser(tx, { email: "bob@test.co" });
      expect(await lookupAsAnonymous(tx, userA.id)).toBe(userA.email);
      expect(await lookupAsAnonymous(tx, userB.id)).toBe(userB.email);
      // Sanity: ambos IDs son distintos.
      expect(userA.id).not.toBe(userB.id);
    });
  });

  it("ACL: EXECUTE concedido a app_system y denegado a PUBLIC", async () => {
    // Mismo invariante que 0009/0010/0022: la lookup nunca es invocable por
    // un rol no previsto. `has_function_privilege` no requiere claim, corre
    // como rol admin (dueño) via `seed`.
    await inRlsTx(async (tx) => {
      const sig = "app.lookup_user_email_by_id(uuid)";
      const [acl] = (await tx.seed(
        `SELECT has_function_privilege('app_system', $1, 'EXECUTE') AS sys,
                has_function_privilege('public',     $1, 'EXECUTE') AS pub`,
        [sig],
      )) as Array<{ sys: boolean; pub: boolean }>;
      expect(acl.sys).toBe(true);
      expect(acl.pub).toBe(false);
    });
  });

  it("ACL columnas: app_system tiene SELECT explícito SOLO sobre (id, email) en neon_auth.user", async () => {
    // Verifica que el DEFINER (que ejecuta como `neondb_owner` que tiene
    // acceso administrativo) es la ÚNICA vía. `app_system` por design NO
    // tiene GRANTs adicionales sobre la tabla neon_auth.user — el lookup es
    // la única superficie expuesta.
    await inRlsTx(async (tx) => {
      const [privs] = (await tx.seed(
        `SELECT has_table_privilege('app_system', 'neon_auth."user"', 'SELECT') AS tbl_sel,
                has_column_privilege('app_system', 'neon_auth."user"', 'banned', 'SELECT') AS col_banned,
                has_column_privilege('app_system', 'neon_auth."user"', 'role', 'SELECT') AS col_role`,
      )) as Array<{ tbl_sel: boolean; col_banned: boolean; col_role: boolean }>;
      // Defense-in-depth: el GRANT direct NO se aplicó — sólo el DEFINER
      // expone email. Esto previene que código fuera de la migration 0023
      // accidentalmente lea banned/role sin ADR explícita.
      expect(privs.tbl_sel).toBe(false);
      expect(privs.col_banned).toBe(false);
      expect(privs.col_role).toBe(false);
    });
  });
});
