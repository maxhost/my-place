import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";

// Feature E · Invite Accept Flow V1.2 Sesión A (ADR-0046 §D1, migration 0022)
// — `app.lookup_custom_domain_by_slug(text)` SECURITY DEFINER. Canal anonymous-
// safe que el helper `buildPlaceCanonicalUrl` (`shared/lib/auth-redirect.ts`)
// usa para resolver el custom domain de un place dado su slug. RLS owner-only
// de `place_domain` (`place_domain_all` en 0000) sigue intacta — el DEFINER
// no la debilita: abre un canal específico con payload mínimo (escalar
// `domain` text, sin metadata sensible: no oauth_client_id, no created_at,
// no verified_at).
//
// Espejo de los tests de 0009 (`lookup-place-by-domain.test.ts`) y 0010
// (`lookup-place-locale-by-slug.test.ts`): seed-as-owner (RLS no aplica)
// sembra `place` + `place_domain`, luego se baja a `app_system` con claim
// vacío (caller anonymous) e invoca la función como en runtime. ROLLBACK
// siempre — cero footprint en `test`.

afterAll(() => endRlsAdminPool());

// Sembra un place fresco. ADR-0035 §2: `place.founder_user_id NOT NULL`
// desde S1; el helper crea un app_user dummy interno para satisfacer el
// constraint (la lookup DEFINER no lee la columna ownership).
async function seedPlace(
  tx: RlsTx,
  opts: { slug: string; locale?: string; archived?: boolean } = { slug: "p1" },
): Promise<{ pid: string; slug: string }> {
  const archivedExpr = opts.archived ? "now()" : "NULL";
  const dummyAuth = `dummy-${opts.slug}-${Math.random().toString(36).slice(2, 8)}`;
  const [{ id: founderId }] = (await tx.seed(
    `INSERT INTO app_user (auth_user_id,email,display_name,handle)
     VALUES ($1, $2, 'D', $3) RETURNING id`,
    [dummyAuth, `${dummyAuth}@x.com`, `h_${dummyAuth}`],
  )) as Array<{ id: string }>;
  const [{ id }] = (await tx.seed(
    `INSERT INTO place (slug, name, billing_mode, default_locale, archived_at, founder_user_id)
     VALUES ($1, 'P', 'OWNER_PAYS', $2, ${archivedExpr}, $3) RETURNING id`,
    [opts.slug, opts.locale ?? "es", founderId],
  )) as Array<{ id: string }>;
  return { pid: id, slug: opts.slug };
}

// Sembra una fila de `place_domain` con flags configurables. Default = activo
// + verified (estado que el lookup debe servir).
async function seedDomain(
  tx: RlsTx,
  pid: string,
  domain: string,
  opts: { verified?: boolean; archived?: boolean } = {},
) {
  const verifiedExpr = opts.verified === false ? "NULL" : "now()";
  const archivedExpr = opts.archived ? "now()" : "NULL";
  await tx.seed(
    `INSERT INTO place_domain (place_id, domain, verified_at, archived_at)
     VALUES ($1, $2, ${verifiedExpr}, ${archivedExpr})`,
    [pid, domain],
  );
}

// Helper: invoca la función como caller anonymous (claim vacío, mismo wire
// del RSC que invoca buildPlaceCanonicalUrl sin contexto de sesión owner).
async function lookupAsAnonymous(tx: RlsTx, slug: string): Promise<string | null> {
  await tx.as(null);
  const rows = (await tx.q(
    `SELECT app.lookup_custom_domain_by_slug($1) AS domain`,
    [slug],
  )) as Array<{ domain: string | null }>;
  return rows[0].domain;
}

describe("Sesión A app.lookup_custom_domain_by_slug — DEFINER anonymous lookup (ADR-0046 §D1)", () => {
  it("happy path: slug con domain verified + activo → retorna el `domain` text", async () => {
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlace(tx, { slug: "mi-place" });
      await seedDomain(tx, pid, "nocodecompany.co");
      const domain = await lookupAsAnonymous(tx, "mi-place");
      expect(domain).toBe("nocodecompany.co");
    });
  });

  it("slug sin ningún domain configurado → NULL (zero rows)", async () => {
    await inRlsTx(async (tx) => {
      await seedPlace(tx, { slug: "sin-domain" });
      // No se sembra ninguna fila en place_domain para este place.
      const domain = await lookupAsAnonymous(tx, "sin-domain");
      expect(domain).toBeNull();
    });
  });

  it("verified_at IS NULL (pending) → NULL — pending no rutea", async () => {
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlace(tx, { slug: "pending-place" });
      await seedDomain(tx, pid, "pending.co", { verified: false });
      const domain = await lookupAsAnonymous(tx, "pending-place");
      expect(domain).toBeNull();
    });
  });

  it("place_domain.archived_at IS NOT NULL → NULL — archived libera el dominio del lookup", async () => {
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlace(tx, { slug: "archived-domain" });
      await seedDomain(tx, pid, "old.co", { archived: true });
      const domain = await lookupAsAnonymous(tx, "archived-domain");
      expect(domain).toBeNull();
    });
  });

  it("place.archived_at IS NOT NULL → NULL — place tombstoneado (ADR-0003)", async () => {
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlace(tx, {
        slug: "tombstoned",
        archived: true,
      });
      await seedDomain(tx, pid, "tombstoned.co");
      const domain = await lookupAsAnonymous(tx, "tombstoned");
      expect(domain).toBeNull();
    });
  });

  it("slug inexistente → NULL (zero rows, sin lateral info vs 'sin domain')", async () => {
    await inRlsTx(async (tx) => {
      // No se sembra ningún place ni domain. El caller no puede distinguir
      // "slug inexistente" de "place sin custom domain" — ambos NULL.
      const domain = await lookupAsAnonymous(tx, "ghost-slug");
      expect(domain).toBeNull();
    });
  });

  it("case-insensitive: `Mi-Place` matchea fila `mi-place`", async () => {
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlace(tx, { slug: "mi-place" });
      await seedDomain(tx, pid, "nocodecompany.co");
      const domain = await lookupAsAnonymous(tx, "Mi-Place");
      expect(domain).toBe("nocodecompany.co");
    });
  });

  it("DEFINER bypass: caller `app_system` sin claim (anonymous) recibe el domain", async () => {
    // Clave de seguridad del pattern: el RSC del invite flow corre bajo
    // `app_system` SIN sesión owner del place inviting. Sin DEFINER, el SELECT
    // directo sobre place_domain da 0 rows (RLS owner-only via place_ownership).
    // Con DEFINER, el dueño de la función (`neondb_owner`, BYPASSRLS) hace el
    // SELECT por el caller — el caller mantiene rol `app_system` sin claim,
    // pero ve el domain resuelto.
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlace(tx, { slug: "anon-test" });
      await seedDomain(tx, pid, "anon.co");
      await tx.as(null);
      const [whoami] = (await tx.q(
        `SELECT current_user AS role, nullif(current_setting('request.jwt.claims', true), '') AS claims`,
      )) as Array<{ role: string; claims: string | null }>;
      expect(whoami.role).toBe("app_system");
      expect(whoami.claims).toBeNull();
      const rows = (await tx.q(
        `SELECT app.lookup_custom_domain_by_slug($1) AS domain`,
        ["anon-test"],
      )) as Array<{ domain: string | null }>;
      expect(rows[0].domain).toBe("anon.co");
    });
  });

  it("RLS regression: SELECT directo sobre place_domain SIN DEFINER (caller anónimo) → 0 rows", async () => {
    // Verifica que el DEFINER NO debilitó la base. El SELECT directo (sin
    // la función app.lookup_custom_domain_by_slug) corre bajo el rol del
    // caller (`app_system`) con la policy owner-only `place_domain_all` — un
    // caller sin claim no matchea ninguna fila vía `place_ownership`.
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlace(tx, { slug: "rls-test" });
      await seedDomain(tx, pid, "rls.co");
      await tx.as(null);
      const rows = (await tx.q(
        `SELECT domain FROM place_domain WHERE domain = 'rls.co'`,
      )) as Array<{ domain: string }>;
      expect(rows).toHaveLength(0);
    });
  });

  it("LIMIT 1 defense-in-depth: shape escalar (no array)", async () => {
    // El partial unique de 0008 (`place_domain_domain_active_unq` WHERE
    // archived_at IS NULL) garantiza ≤1 fila activa por (domain), pero no
    // por (place_id) — un place podría teóricamente tener N domains
    // simultáneos. LIMIT 1 cubre el caso teórico de drift histórico. Verifica
    // que el retorno es escalar (string), no array.
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlace(tx, { slug: "limit-test" });
      await seedDomain(tx, pid, "alpha.co");
      const rows = (await tx.q(
        `SELECT app.lookup_custom_domain_by_slug($1) AS domain`,
        ["limit-test"],
      )) as Array<{ domain: unknown }>;
      expect(typeof rows[0].domain).toBe("string");
      expect(Array.isArray(rows[0].domain)).toBe(false);
    });
  });

  it("payload mínimo: retorna SÓLO el domain text, no jsonb con metadata extra", async () => {
    // El contrato canónico es text escalar (no jsonb con place_id, slug,
    // verified_at, etc.) — paralelo a 0010. Esto cierra leak: el caller
    // anónimo aprende SÓLO el host, no la id interna del place ni timestamps.
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlace(tx, { slug: "shape-test" });
      await seedDomain(tx, pid, "shape.co");
      const rows = (await tx.q(
        `SELECT app.lookup_custom_domain_by_slug($1) AS payload`,
        ["shape-test"],
      )) as Array<{ payload: unknown }>;
      // Verifica que es text escalar plano, no objeto.
      expect(typeof rows[0].payload).toBe("string");
      expect(rows[0].payload).toBe("shape.co");
    });
  });

  it("ACL: EXECUTE concedido a app_system y denegado a PUBLIC", async () => {
    // Mismo invariante que 0009 y 0010: la lookup nunca es invocable por
    // un rol no previsto. `has_function_privilege` no requiere claim,
    // corre como rol admin (dueño) — `seed`.
    await inRlsTx(async (tx) => {
      const sig = "app.lookup_custom_domain_by_slug(text)";
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
