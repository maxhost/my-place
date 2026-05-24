import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";

// Feature B · S1 (ADR-0031 §1) — `app.lookup_place_by_domain(text)` SECURITY
// DEFINER. Único canal anonymous-safe que el proxy/middleware usa para
// resolver un custom domain verified contra el slug del place. RLS
// owner-only de `place_domain` (ADR-0012 §2, policy `place_domain_all`)
// sigue intacta — el DEFINER no la debilita: abre un canal específico,
// con filtrado explícito + payload mínimo + EXECUTE restringido a
// `app_system`.
//
// Pattern verificado en S3 (`create-place.test.ts`): seed-as-owner (RLS no
// aplica) sembra `place` + `place_domain`, luego se baja a `app_system`
// con claim vacío (caller anonymous, como el proxy edge) e invoca la
// función como en runtime. ROLLBACK siempre — cero footprint en `test`.

afterAll(() => endRlsAdminPool());

// Sembra un place fresco (sin owner — la lookup no requiere ownership,
// se valida sólo `verified_at`/`archived_at`). Devuelve `{ pid, slug }`.
// ADR-0035 §2: `place.founder_user_id NOT NULL` desde S1; el helper crea un
// app_user dummy interno por llamada para satisfacer el constraint (la
// lookup DEFINER no lee la columna; ownership e identidad no son relevantes).
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

// Sembra una fila de `place_domain` con flags configurables (verified +
// archived). Default = activo + verified (estado que el lookup debe servir).
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

// Helper: invoca la función como caller anonymous (claim vacío =
// `request.jwt.claims` = `""`, mismo wire del proxy edge sin sesión).
async function lookupAsAnonymous(tx: RlsTx, host: string) {
  await tx.as(null); // claim vacío — sin `sub`
  const rows = (await tx.q(
    `SELECT app.lookup_place_by_domain($1) AS payload`,
    [host],
  )) as Array<{ payload: unknown }>;
  return rows[0].payload;
}

describe("S1 app.lookup_place_by_domain — DEFINER anonymous lookup (ADR-0031 §1)", () => {
  it("happy path: host verified + activo + place activo → jsonb {place_id, slug, default_locale}", async () => {
    await inRlsTx(async (tx) => {
      const { pid, slug } = await seedPlace(tx, {
        slug: "mi-place",
        locale: "pt",
      });
      await seedDomain(tx, pid, "nocodecompany.co");
      const payload = await lookupAsAnonymous(tx, "nocodecompany.co");
      expect(payload).toEqual({
        place_id: pid,
        slug,
        default_locale: "pt",
      });
    });
  });

  it("verified_at IS NULL (pending) → NULL — pending no rutea", async () => {
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlace(tx, { slug: "pending-place" });
      await seedDomain(tx, pid, "pending.co", { verified: false });
      const payload = await lookupAsAnonymous(tx, "pending.co");
      expect(payload).toBeNull();
    });
  });

  it("place_domain.archived_at IS NOT NULL → NULL — archived libera el dominio del lookup", async () => {
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlace(tx, { slug: "archived-domain" });
      await seedDomain(tx, pid, "old.co", { archived: true });
      const payload = await lookupAsAnonymous(tx, "old.co");
      expect(payload).toBeNull();
    });
  });

  it("place.archived_at IS NOT NULL → NULL — place tombstoneado (ADR-0003)", async () => {
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlace(tx, {
        slug: "tombstoned",
        archived: true,
      });
      await seedDomain(tx, pid, "tombstoned.co");
      const payload = await lookupAsAnonymous(tx, "tombstoned.co");
      expect(payload).toBeNull();
    });
  });

  it("host inexistente en place_domain → NULL (zero rows)", async () => {
    await inRlsTx(async (tx) => {
      // No se sembra ninguna fila para "unknown.co".
      const payload = await lookupAsAnonymous(tx, "unknown.co");
      expect(payload).toBeNull();
    });
  });

  it("case-insensitive: `NoCodeCompany.CO` matchea fila `nocodecompany.co`", async () => {
    await inRlsTx(async (tx) => {
      const { pid, slug } = await seedPlace(tx, { slug: "case-test" });
      await seedDomain(tx, pid, "nocodecompany.co");
      const payload = await lookupAsAnonymous(tx, "NoCodeCompany.CO");
      expect(payload).toMatchObject({ place_id: pid, slug });
    });
  });

  it("DEFINER bypass: caller `app_system` sin claim (anonymous) recibe el payload", async () => {
    // Clave de seguridad del pattern: el proxy edge corre sin sesión
    // (`request.jwt.claims` = `""`). Sin DEFINER, el SELECT directo daría
    // 0 rows (RLS owner-only via place_ownership). Con DEFINER, el dueño
    // de la función (`neondb_owner`, BYPASSRLS) hace el SELECT por el
    // caller — el caller mantiene rol `app_system` sin claim, pero ve el
    // resultado del jsonb_build_object.
    await inRlsTx(async (tx) => {
      const { pid, slug } = await seedPlace(tx, {
        slug: "anon-test",
        locale: "fr",
      });
      await seedDomain(tx, pid, "anon.co");
      // Confirmar que NO hay claim seteado (anonymous absoluto).
      await tx.as(null);
      const [whoami] = (await tx.q(
        `SELECT current_user AS role, nullif(current_setting('request.jwt.claims', true), '') AS claims`,
      )) as Array<{ role: string; claims: string | null }>;
      expect(whoami.role).toBe("app_system");
      expect(whoami.claims).toBeNull();
      // La función entrega data pese a no haber claim.
      const rows = (await tx.q(
        `SELECT app.lookup_place_by_domain($1) AS payload`,
        ["anon.co"],
      )) as Array<{ payload: unknown }>;
      expect(rows[0].payload).toEqual({
        place_id: pid,
        slug,
        default_locale: "fr",
      });
    });
  });

  it("RLS regression: SELECT directo sobre place_domain SIN DEFINER (caller anónimo) → 0 rows", async () => {
    // Verifica que el DEFINER NO debilitó la base. El SELECT directo (sin
    // la función app.lookup_place_by_domain) corre bajo el rol del caller
    // (`app_system`) con la policy owner-only `place_domain_all` — un
    // caller sin claim no matchea ninguna fila vía `place_ownership`.
    await inRlsTx(async (tx) => {
      const { pid } = await seedPlace(tx, { slug: "rls-test" });
      await seedDomain(tx, pid, "rls.co");
      await tx.as(null); // anonymous
      const rows = (await tx.q(
        `SELECT id FROM place_domain WHERE domain = 'rls.co'`,
      )) as Array<{ id: string }>;
      expect(rows).toHaveLength(0);
    });
  });

  it("LIMIT 1 defense-in-depth: si por bug hubiera 2 filas activas con mismo domain, retorna 1 sola (no array)", async () => {
    // El partial unique de 0008 (`place_domain_domain_active_unq` WHERE
    // archived_at IS NULL) garantiza ≤1 fila activa por (domain). LIMIT
    // 1 en la función es defense-in-depth ante drift histórico. Para el
    // test forzamos la situación archivando la primera, luego insertando
    // una segunda activa (el partial unique permite esto), y verificamos
    // que el lookup retorna *exactamente una* fila (jsonb objeto, no
    // array). El partial unique nunca permitirá *2 activas simultáneas*
    // — el LIMIT 1 cubre el caso teórico de bug futuro o restore parcial.
    await inRlsTx(async (tx) => {
      const { pid, slug } = await seedPlace(tx, { slug: "limit-test" });
      // Fila 1: archivada (libera el unique parcial).
      await seedDomain(tx, pid, "dup.co", { archived: true });
      // Fila 2: activa y verified.
      await seedDomain(tx, pid, "dup.co");
      const payload = await lookupAsAnonymous(tx, "dup.co");
      // Verifica: 1 sola fila resuelta, shape de objeto (no array).
      expect(payload).toMatchObject({ place_id: pid, slug });
      expect(Array.isArray(payload)).toBe(false);
    });
  });

  it("ACL: EXECUTE concedido a app_system y denegado a PUBLIC", async () => {
    // Mismo invariante que `app.create_place` (S3, ADR-0012 §3): la
    // lookup nunca es invocable por un rol no previsto. `has_function_
    // privilege` no requiere claim, corre como rol admin (dueño) — `seed`.
    await inRlsTx(async (tx) => {
      const sig = "app.lookup_place_by_domain(text)";
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
