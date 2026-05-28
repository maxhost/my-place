import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";

// Feature E · Invite Accept Flow V1.2 Sesión D.fix.3 (ADR-0046 §"Addendum
// operacional — Sesión D.fix.3", migration 0024) — `app.lookup_user_identity_
// by_id(uuid)` SECURITY DEFINER. Canal anonymous-safe que el helper unificado
// `getCurrentUserIdentityForRequest` (`shared/lib/current-user-identity.ts`)
// consume via `getAuthenticatedDbForRequest` (ADR-0034 coordinator) para
// resolver la identidad mínima (email + name) del user logueado zone-aware
// (apex via Neon Auth SDK cookie cross-subdomain + custom domain via SSO
// local cookie). Cierra el último callsite de `getAuth().getSession()` con
// riesgo zone-aware: `acceptInvitationAction` (D.fix.3.b).
//
// Espejo de los tests de 0023 (`lookup-user-email-by-id.test.ts`): mismo
// pattern seed-as-owner + bajada a `app_system` con claim vacío (caller
// anonymous-like, paralelo al RSC/Action pre-mintaje de cookie SSO local).
// ROLLBACK siempre — cero footprint en `test`. Diferencia única: payload jsonb
// `{email, name}` en lugar de text escalar — paridad con 0009.

afterAll(() => endRlsAdminPool());

async function seedUser(
  tx: RlsTx,
  opts: { email?: string; name?: string } = {},
): Promise<{ id: string; email: string; name: string }> {
  const email = opts.email ?? `seed-${Math.random().toString(36).slice(2, 10)}@x.com`;
  const name = opts.name ?? "Seed User";
  const [{ id }] = (await tx.seed(
    `INSERT INTO neon_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, true, now(), now()) RETURNING id`,
    [name, email],
  )) as Array<{ id: string }>;
  return { id, email, name };
}

async function lookupAsAnonymous(
  tx: RlsTx,
  id: string,
): Promise<{ email: string; name: string } | null> {
  await tx.as(null);
  const rows = (await tx.q(
    `SELECT app.lookup_user_identity_by_id($1::uuid) AS payload`,
    [id],
  )) as Array<{ payload: { email: string; name: string } | null }>;
  return rows[0].payload;
}

describe("Sesión D.fix.3 app.lookup_user_identity_by_id — DEFINER anonymous lookup (ADR-0046 §Addendum Sesión D.fix.3)", () => {
  it("happy path: id de user existente → retorna jsonb `{email, name}`", async () => {
    await inRlsTx(async (tx) => {
      const { id, email, name } = await seedUser(tx, {
        email: "happy@nocodecompany.co",
        name: "Happy User",
      });
      const result = await lookupAsAnonymous(tx, id);
      expect(result).toEqual({ email, name });
    });
  });

  it("id inexistente (UUID válido pero no en la tabla) → NULL", async () => {
    await inRlsTx(async (tx) => {
      const result = await lookupAsAnonymous(
        tx,
        "00000000-0000-0000-0000-000000000000",
      );
      expect(result).toBeNull();
    });
  });

  it("DEFINER bypass: caller `app_system` sin claim recibe el payload", async () => {
    // Mismo invariante que 0023: el Server Action / RSC del invite flow
    // post-SSO-chain corre bajo `app_system`. Sin DEFINER, SELECT directo
    // sobre `neon_auth.user` da permission denied (zero GRANTs para app_
    // system). Con DEFINER, el dueño (`neondb_owner` con acceso administra-
    // tivo) hace el SELECT por el caller.
    await inRlsTx(async (tx) => {
      const { id, email, name } = await seedUser(tx, {
        email: "definer@test.co",
        name: "Definer User",
      });
      await tx.as(null);
      const [whoami] = (await tx.q(
        `SELECT current_user AS role, nullif(current_setting('request.jwt.claims', true), '') AS claims`,
      )) as Array<{ role: string; claims: string | null }>;
      expect(whoami.role).toBe("app_system");
      expect(whoami.claims).toBeNull();
      const rows = (await tx.q(
        `SELECT app.lookup_user_identity_by_id($1::uuid) AS payload`,
        [id],
      )) as Array<{ payload: { email: string; name: string } | null }>;
      expect(rows[0].payload).toEqual({ email, name });
    });
  });

  it("GRANTs regression: SELECT directo sobre neon_auth.user SIN DEFINER (caller anónimo) → permission denied", async () => {
    // Verifica que el DEFINER NO debilitó la base. SELECT directo (sin la
    // función `app.lookup_user_identity_by_id`) corre bajo el rol del caller
    // (`app_system`) que NO tiene GRANTs sobre `neon_auth.user`. El intento
    // debe ser rechazado.
    await inRlsTx(async (tx) => {
      await seedUser(tx, { email: "grants@test.co" });
      await tx.as(null);
      const denied = await tx.denied(
        `SELECT email, name FROM neon_auth."user" LIMIT 1`,
      );
      expect(denied).toBe(true);
    });
  });

  it("LIMIT 1 defense-in-depth: shape jsonb scalar (no array de objects)", async () => {
    // `neon_auth.user.id` es PRIMARY KEY → ≤1 fila por id garantizado por
    // constraint. LIMIT 1 = defense-in-depth redundante explícito. Verifica
    // que el retorno es jsonb scalar (object), no jsonb array.
    await inRlsTx(async (tx) => {
      const { id } = await seedUser(tx, { email: "scalar@test.co" });
      const rows = (await tx.q(
        `SELECT app.lookup_user_identity_by_id($1::uuid) AS payload`,
        [id],
      )) as Array<{ payload: unknown }>;
      expect(typeof rows[0].payload).toBe("object");
      expect(Array.isArray(rows[0].payload)).toBe(false);
      expect(rows[0].payload).not.toBeNull();
    });
  });

  it("payload mínimo: SOLO {email, name} — NO banned, role, image, emailVerified, createdAt", async () => {
    // Contrato canónico: jsonb shape `{email, name}` — defense-in-depth vs
    // GRANT amplio. Si futura feature necesita `banned` o `role`, agregar
    // DEFINER específico (NO extender éste).
    await inRlsTx(async (tx) => {
      const { id, email, name } = await seedUser(tx, {
        email: "shape@test.co",
        name: "Shape User",
      });
      const rows = (await tx.q(
        `SELECT app.lookup_user_identity_by_id($1::uuid) AS payload`,
        [id],
      )) as Array<{ payload: Record<string, unknown> | null }>;
      const payload = rows[0].payload;
      expect(payload).not.toBeNull();
      const keys = Object.keys(payload!).sort();
      expect(keys).toEqual(["email", "name"]);
      expect(payload).toEqual({ email, name });
    });
  });

  it("aislamiento: lookup de id_A NO retorna identidad de user_B (mismatch defense)", async () => {
    await inRlsTx(async (tx) => {
      const userA = await seedUser(tx, {
        email: "alice@test.co",
        name: "Alice",
      });
      const userB = await seedUser(tx, {
        email: "bob@test.co",
        name: "Bob",
      });
      expect(await lookupAsAnonymous(tx, userA.id)).toEqual({
        email: userA.email,
        name: userA.name,
      });
      expect(await lookupAsAnonymous(tx, userB.id)).toEqual({
        email: userB.email,
        name: userB.name,
      });
      expect(userA.id).not.toBe(userB.id);
    });
  });

  it("ACL: EXECUTE concedido a app_system y denegado a PUBLIC", async () => {
    // Mismo invariante que 0009/0010/0022/0023: la lookup nunca es invocable
    // por un rol no previsto.
    await inRlsTx(async (tx) => {
      const sig = "app.lookup_user_identity_by_id(uuid)";
      const [acl] = (await tx.seed(
        `SELECT has_function_privilege('app_system', $1, 'EXECUTE') AS sys,
                has_function_privilege('public',     $1, 'EXECUTE') AS pub`,
        [sig],
      )) as Array<{ sys: boolean; pub: boolean }>;
      expect(acl.sys).toBe(true);
      expect(acl.pub).toBe(false);
    });
  });

  it("ACL columnas: app_system NO tiene SELECT directo sobre (email, name) en neon_auth.user", async () => {
    // Defense-in-depth: el DEFINER (que ejecuta como `neondb_owner` con
    // acceso administrativo) es la ÚNICA vía. `app_system` por design NO
    // tiene GRANTs adicionales sobre la tabla neon_auth.user — el lookup es
    // la única superficie expuesta.
    await inRlsTx(async (tx) => {
      const [privs] = (await tx.seed(
        `SELECT has_table_privilege('app_system', 'neon_auth."user"', 'SELECT') AS tbl_sel,
                has_column_privilege('app_system', 'neon_auth."user"', 'banned', 'SELECT') AS col_banned,
                has_column_privilege('app_system', 'neon_auth."user"', 'role', 'SELECT') AS col_role,
                has_column_privilege('app_system', 'neon_auth."user"', 'email', 'SELECT') AS col_email,
                has_column_privilege('app_system', 'neon_auth."user"', 'name', 'SELECT') AS col_name`,
      )) as Array<{
        tbl_sel: boolean;
        col_banned: boolean;
        col_role: boolean;
        col_email: boolean;
        col_name: boolean;
      }>;
      expect(privs.tbl_sel).toBe(false);
      expect(privs.col_banned).toBe(false);
      expect(privs.col_role).toBe(false);
      expect(privs.col_email).toBe(false);
      expect(privs.col_name).toBe(false);
    });
  });
});
