-- Feature E — Invite Accept Flow V1.2 · Sesión A (ADR-0046 §D1, 2026-05-26).
--
-- Lookup ANONYMOUS del custom domain verificado de un place identificado por
-- slug. Inverso de 0009 (`app.lookup_place_by_domain`, host → place): acá
-- slug → domain. Habilita la emisión zone-aware de URLs canónicas del place:
-- dado un slug, el helper `buildPlaceCanonicalUrl`
-- (`src/shared/lib/auth-redirect.ts`) decide si emitir
-- `https://nocodecompany.co{path}` (custom domain verified) o
-- `https://mi-place.place.community{path}` (subdomain canon fallback).
--
-- ## Corrección operacional al ADR-0046 (detectada en Sesión A, 2026-05-26)
--
-- ADR-0046 §"Alcance" prometía "NO migration nueva" basándose en la idea de
-- que la lookup se podía hacer con un `SELECT … FROM place_domain JOIN place
-- WHERE slug = $1` directo. Verificado en Sesión A: `place_domain` tiene RLS
-- ENABLE + policy owner-only `place_domain_all` (migración 0000), y el pool
-- runtime corre con rol `app_system` SIN `BYPASSRLS` (`src/db/client.ts:15`,
-- ADR-0011). El SELECT directo sin DEFINER → 0 rows para todo caller anónimo
-- (como el RSC que renderiza `settings/members` o `invite/[token]`). Única
-- vía canon: DEFINER específica con payload mínimo + REVOKE/GRANT explícito —
-- exactamente el pattern de 0009. La migration 0022 cierra el hueco; el
-- contrato de ADR-0046 §D1 queda intacto (helper, wrapper, wire iguales).
--
-- Espejo estructural de 0009 (`app.lookup_place_by_domain`): mismo pattern
-- DEFINER, mismo header de invariantes, mismo ACL. Difiere sólo en:
--   - input: slug en lugar de host (sin strip de port).
--   - tabla base: JOIN `place ↔ place_domain` (mismo JOIN que 0009; el WHERE
--     filtra por slug en lugar de domain).
--   - return: `text` (domain escalar) en lugar de `jsonb` (payload). Paralelo
--     a 0010 (`lookup_place_locale_by_slug`) que también retorna text — el
--     shape es 1 escalar; envolver en jsonb agrega ceremonia innecesaria.
--
-- ## Por qué SECURITY DEFINER
--
-- `place_domain` tiene RLS ENABLE + policy owner-only via `place_ownership`
-- (`place_domain_all` en 0000_youthful_hydra.sql). Un caller sin claim (RSC
-- renderizando settings/members del invite flow V1.2) no matchea ninguna
-- policy → 0 rows. DEFINER + dueño `neondb_owner` (BYPASSRLS) habilita el
-- SELECT específico SIN ampliar superficie: la función filtra explícitamente
-- por `verified_at IS NOT NULL` + ambos `archived_at IS NULL`, devolviendo
-- ÚNICAMENTE el `domain` escalar — no expone `oauth_client_id`, `created_at`,
-- `verified_at`, ni place data. El domain es información pública por
-- definición (lo ve cualquier visitor en el browser).
--
-- ## Invariantes
--
-- 1. **search_path fijo** (`public, pg_temp`): anti-hijack obligatorio en
--    DEFINER. Si un caller cambia el search_path, las refs sin schema
--    quoting siguen apuntando a `public.place` y `public.place_domain`.
-- 2. **STABLE**: no modifica DB, sólo lee. Habilita inlining del optimizer.
-- 3. **lower(p.slug) = lower(p_slug)**: case-insensitive match. El registro
--    de slugs vía `app.create_place` ya normaliza a lowercase en la app
--    layer; defense-in-depth (paralelo a 0009/0010).
-- 4. **`pd.verified_at IS NOT NULL`**: solo dominios verified rutean. Un
--    place con domain pending (DNS no propagado) cae al subdomain canon —
--    paridad con 0009 (un visit a `pending.co` cae al marketing fallback).
-- 5. **`pd.archived_at IS NULL AND p.archived_at IS NULL`**: place archivado
--    O domain archivado → NULL. El owner que archiva su domain (`<DomainSection>`
--    Archive flow) deja de rutear URLs canónicas a ese host inmediatamente.
-- 6. **`LIMIT 1`**: el partial unique de 0008 (`place_domain_domain_active_unq`
--    WHERE archived_at IS NULL) garantiza ≤1 fila ACTIVA por (domain), pero
--    no por (place_id) — un place podría teóricamente tener N domains activos
--    simultáneamente (no hay constraint per place_id). En la práctica, el
--    register-action archiva el anterior antes de insertar uno nuevo
--    (`registerCustomDomainAction` flow). LIMIT 1 = defense-in-depth ante
--    drift histórico o restore parcial; si hubiera 2 activos retorna 1 sólo
--    (no array), determinístico vía orden natural del index.
-- 7. **Payload `text` escalar (no jsonb)**: shape de 1 valor. El wrapper TS
--    (`src/shared/lib/custom-domain-by-slug-lookup.ts`) parsea con Zod
--    `z.string().min(1)` — defense-in-depth ante drift extremo (NULL inesperado,
--    tipo no-string por bug futuro). Renombre NO aplica (no hay snake_case
--    en un text escalar).
-- 8. **EXECUTE concedido SÓLO a `app_system`** (REVOKE FROM PUBLIC + GRANT TO
--    app_system): rol PUBLIC nunca puede invocarla, ni siquiera si Neon
--    agregara un nuevo rol de tercero. `app_system` es el rol runtime canónico
--    (ADR-0011), ya tiene USAGE sobre schema app desde 0000.
-- 9. **Slug inexistente / sin domain verified / archivado → NULL** (no
--    exception): el caller (`custom-domain-by-slug-lookup.ts`) trata NULL =
--    "no es un place con custom domain conocido" → helper
--    `buildPlaceCanonicalUrl` cae a subdomain canon (`buildSubdomainCanonicalUrl`).
--    Sin información lateral (NO distingue "slug no existe" de "place sin
--    custom domain" de "domain archivado" — desde afuera son idénticos a
--    propósito; cero leak adicional sobre la existencia/configuración).
--
-- ## Reverse SQL (rollback puntual)
--
--   REVOKE EXECUTE ON FUNCTION app.lookup_custom_domain_by_slug(text) FROM "app_system";
--   DROP FUNCTION IF EXISTS app.lookup_custom_domain_by_slug(text);
--
-- Sin caveats: la función es read-only, no deja efecto residual.
CREATE OR REPLACE FUNCTION app.lookup_custom_domain_by_slug(p_slug text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT pd.domain
  FROM place_domain pd
  JOIN place p ON p.id = pd.place_id
  WHERE lower(p.slug) = lower(p_slug)
    AND pd.verified_at IS NOT NULL
    AND pd.archived_at IS NULL
    AND p.archived_at IS NULL
  LIMIT 1;
$$;--> statement-breakpoint
-- EXECUTE solo `app_system` (no PUBLIC): la lookup nunca es invocable por
-- un rol no previsto. Idempotente (drizzle re-aplica en cada branch nuevo).
REVOKE EXECUTE ON FUNCTION app.lookup_custom_domain_by_slug(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.lookup_custom_domain_by_slug(text) TO "app_system";
