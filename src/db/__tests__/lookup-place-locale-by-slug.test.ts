import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";

// Feature B · S4b (ADR-0031 §"Fuente 2") — `app.lookup_place_locale_by_slug(text)`
// SECURITY DEFINER. Canal anonymous-safe que el layout `(app)/place/
// [placeSlug]/` usa para resolver `default_locale` cuando el caller NO tiene
// sesión (visitor anónimo en subdomain canon). RLS owner-only de `place`
// (ADR-0012 §1, policies `place_sel/upd/del`) sigue intacta — el DEFINER
// no la debilita: abre un canal específico con payload mínimo (escalar
// `default_locale` validado por CHECK constraint, sin metadata sensible).
//
// Espejo del pattern verificado en `lookup-place-by-domain.test.ts` (S1):
// seed-as-owner (RLS no aplica) sembra `place`, luego se baja a `app_system`
// con claim vacío (caller anonymous, como el layout sin sesión) e invoca la
// función como en runtime. ROLLBACK siempre — cero footprint en `test`.

afterAll(() => endRlsAdminPool());

// Sembra un place fresco (sin owner — la lookup no requiere ownership; el
// DEFINER bypassa RLS y el filtro es sólo `archived_at IS NULL`). Devuelve
// `{ pid, slug, locale }`. ADR-0035 §2: `place.founder_user_id NOT NULL`
// desde S1; el helper crea un app_user dummy interno (la lookup no lee la
// columna, sólo se satisface el constraint).
async function seedPlace(
  tx: RlsTx,
  opts: { slug: string; locale?: string; archived?: boolean } = { slug: "p1" },
): Promise<{ pid: string; slug: string; locale: string }> {
  const archivedExpr = opts.archived ? "now()" : "NULL";
  const locale = opts.locale ?? "es";
  const dummyAuth = `dummy-${opts.slug}-${Math.random().toString(36).slice(2, 8)}`;
  const [{ id: founderId }] = (await tx.seed(
    `INSERT INTO app_user (auth_user_id,email,display_name,handle)
     VALUES ($1, $2, 'D', $3) RETURNING id`,
    [dummyAuth, `${dummyAuth}@x.com`, `h_${dummyAuth}`],
  )) as Array<{ id: string }>;
  const [{ id }] = (await tx.seed(
    `INSERT INTO place (slug, name, billing_mode, default_locale, archived_at, founder_user_id)
     VALUES ($1, 'P', 'OWNER_PAYS', $2, ${archivedExpr}, $3) RETURNING id`,
    [opts.slug, locale, founderId],
  )) as Array<{ id: string }>;
  return { pid: id, slug: opts.slug, locale };
}

// Helper: invoca la función como caller anonymous (claim vacío =
// `request.jwt.claims` = `""`, mismo wire del layout sin sesión).
async function lookupAsAnonymous(tx: RlsTx, slug: string): Promise<string | null> {
  await tx.as(null); // claim vacío — sin `sub`
  const rows = (await tx.q(
    `SELECT app.lookup_place_locale_by_slug($1) AS locale`,
    [slug],
  )) as Array<{ locale: string | null }>;
  return rows[0].locale;
}

describe("S4b app.lookup_place_locale_by_slug — DEFINER anonymous lookup (ADR-0031 §Fuente 2)", () => {
  it("happy path: slug activo → retorna `default_locale` configurado por owner", async () => {
    await inRlsTx(async (tx) => {
      await seedPlace(tx, { slug: "mi-place", locale: "pt" });
      const locale = await lookupAsAnonymous(tx, "mi-place");
      expect(locale).toBe("pt");
    });
  });

  it("place.archived_at IS NOT NULL → NULL — place tombstoneado deja de rutear su locale", async () => {
    // Paralelo a 0009: un place archivado no expone metadata via lookup
    // anonymous. El visitor en subdomain canon ve fallback canónico
    // ('es') hasta que el owner reactive (V2) o el slug sea liberado.
    await inRlsTx(async (tx) => {
      await seedPlace(tx, {
        slug: "tombstoned",
        locale: "fr",
        archived: true,
      });
      const locale = await lookupAsAnonymous(tx, "tombstoned");
      expect(locale).toBeNull();
    });
  });

  it("slug inexistente en place → NULL (zero rows)", async () => {
    await inRlsTx(async (tx) => {
      // No se sembra ninguna fila para "ghost-slug".
      const locale = await lookupAsAnonymous(tx, "ghost-slug");
      expect(locale).toBeNull();
    });
  });

  it("case-insensitive: `Mi-Place` matchea fila `mi-place`", async () => {
    await inRlsTx(async (tx) => {
      await seedPlace(tx, { slug: "mi-place", locale: "de" });
      const locale = await lookupAsAnonymous(tx, "Mi-Place");
      expect(locale).toBe("de");
    });
  });

  it("DEFINER bypass: caller `app_system` sin claim (anonymous) recibe el locale", async () => {
    // Clave de seguridad del pattern: el layout (Server Component) corre
    // bajo `app_system` con la cookie del visitor; sin sesión, `request.
    // jwt.claims` = `""`. Sin DEFINER, el SELECT directo sobre `place` da
    // 0 rows (RLS owner-only via place_ownership). Con DEFINER, el dueño
    // de la función (`neondb_owner`, BYPASSRLS) hace el SELECT por el
    // caller — el caller mantiene rol `app_system` sin claim, pero ve el
    // locale resuelto.
    await inRlsTx(async (tx) => {
      await seedPlace(tx, { slug: "anon-test", locale: "ca" });
      // Confirmar que NO hay claim seteado (anonymous absoluto).
      await tx.as(null);
      const [whoami] = (await tx.q(
        `SELECT current_user AS role, nullif(current_setting('request.jwt.claims', true), '') AS claims`,
      )) as Array<{ role: string; claims: string | null }>;
      expect(whoami.role).toBe("app_system");
      expect(whoami.claims).toBeNull();
      // La función entrega el locale pese a no haber claim.
      const rows = (await tx.q(
        `SELECT app.lookup_place_locale_by_slug($1) AS locale`,
        ["anon-test"],
      )) as Array<{ locale: string | null }>;
      expect(rows[0].locale).toBe("ca");
    });
  });

  it("RLS regression: SELECT directo sobre place SIN DEFINER (caller anónimo) → 0 rows", async () => {
    // Verifica que el DEFINER NO debilitó la base. El SELECT directo (sin
    // la función app.lookup_place_locale_by_slug) corre bajo el rol del
    // caller (`app_system`) con las policies owner-only — un caller sin
    // claim no matchea ninguna fila vía `place_ownership`.
    await inRlsTx(async (tx) => {
      await seedPlace(tx, { slug: "rls-test", locale: "en" });
      await tx.as(null); // anonymous
      const rows = (await tx.q(
        `SELECT default_locale FROM place WHERE slug = 'rls-test'`,
      )) as Array<{ default_locale: string }>;
      expect(rows).toHaveLength(0);
    });
  });

  it("LIMIT 1 defense-in-depth: shape escalar (no array) aún con slug UNIQUE garantizado", async () => {
    // `place.slug` es UNIQUE absoluto (schema/index.ts:89) — a lo sumo
    // 1 fila por slug. LIMIT 1 en la función es defense-in-depth ante
    // bug futuro o restore parcial. Verifica que el retorno es escalar
    // (string), no array.
    await inRlsTx(async (tx) => {
      await seedPlace(tx, { slug: "limit-test", locale: "fr" });
      const rows = (await tx.q(
        `SELECT app.lookup_place_locale_by_slug($1) AS locale`,
        ["limit-test"],
      )) as Array<{ locale: unknown }>;
      expect(typeof rows[0].locale).toBe("string");
      expect(Array.isArray(rows[0].locale)).toBe(false);
      expect(rows[0].locale).toBe("fr");
    });
  });

  it("locale retornado respeta el enum del CHECK constraint (todos los 6 locales operativos)", async () => {
    // Sanity check del shape: para cada uno de los 6 locales operativos
    // (ADR-0024), el lookup retorna exactamente el string esperado. Si
    // un día se agrega un locale en `place_default_locale_check`, este
    // test recuerda actualizar el Zod del wrapper TS — paridad explícita.
    await inRlsTx(async (tx) => {
      const locales = ["es", "en", "fr", "pt", "de", "ca"] as const;
      for (const loc of locales) {
        await seedPlace(tx, { slug: `slug-${loc}`, locale: loc });
        const result = await lookupAsAnonymous(tx, `slug-${loc}`);
        expect(result).toBe(loc);
      }
    });
  });

  it("ACL: EXECUTE concedido a app_system y denegado a PUBLIC", async () => {
    // Mismo invariante que `app.create_place` (S3, ADR-0012 §3) y
    // `app.lookup_place_by_domain` (S1): la lookup nunca es invocable
    // por un rol no previsto. `has_function_privilege` no requiere
    // claim, corre como rol admin (dueño) — `seed`.
    await inRlsTx(async (tx) => {
      const sig = "app.lookup_place_locale_by_slug(text)";
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
