-- Feature B — Custom Domain Routing V1 · S1 (ADR-0031 §1, 2026-05-22).
--
-- Lookup ANONYMOUS de un custom domain verificado contra `place`. Esta
-- función es la ÚNICA vía por la que el proxy/middleware (que NO tiene
-- JWT del visitante; resuelve antes de cualquier auth) lee `place_domain`
-- para decidir si rewrite a `/place/{slug}/...` o caer al marketing
-- fallback. NO se usa para registro ni para owner-only reads (esos pasan
-- por RLS owner-only de S2, policy `place_domain_all`).
--
-- ## Por qué SECURITY DEFINER
--
-- `place_domain` tiene RLS ENABLE + policy owner-only via place_ownership
-- (0001_round_forge.sql `place_domain_all`). Un caller sin claim (proxy
-- edge, request inicial sin sesión) no matchea ninguna policy → 0 rows.
-- DEFINER + dueño `neondb_owner` (BYPASSRLS) habilita el SELECT
-- anonymous SIN ampliar superficie: la función filtra explícitamente por
-- `verified_at IS NOT NULL AND archived_at IS NULL` y devuelve únicamente
-- el payload mínimo que el routing necesita (`place_id`, `slug`,
-- `default_locale`) — no expone otras columnas (`oauth_client_id`,
-- `created_at`, `verified_at`).
--
-- Precedente del pattern: 0002_create_place_fn.sql (DEFINER + search_path
-- + REVOKE/GRANT idempotentes). Header análogo. Migración sin diff de
-- schema → no la genera drizzle-kit; se versiona a mano y se registra en
-- meta/_journal.json.
--
-- ## Invariantes
--
-- 1. **search_path fijo** (`public, pg_temp`): anti-hijack obligatorio en
--    DEFINER. Si un caller cambia el search_path, las refs sin schema
--    quoting siguen apuntando a `public.place_domain`.
-- 2. **STABLE**: no modifica DB, sólo lee. Habilita inlining del optimizer.
-- 3. **lower(domain) = lower(p_host)**: case-insensitive match. El registro
--    en S3 de Feature A ya normaliza a lowercase (`isValidCustomDomain` +
--    `normalize` en `shared/lib/custom-domain.ts`), pero defense-in-depth.
-- 4. **`AND p.archived_at IS NULL`**: un place archivado por owner deja de
--    rutearse en su custom domain (cierra escape hatch si la operación
--    archive-place se implementa antes que un cleanup explícito del
--    `place_domain`).
-- 5. **`LIMIT 1`**: el partial unique de 0008
--    (`place_domain_domain_active_unq` WHERE archived_at IS NULL) garantiza
--    a lo sumo 1 fila activa por (domain). LIMIT 1 = defensa frente a
--    drift histórico improbable.
-- 6. **Payload mínimo via jsonb_build_object**: shape estable
--    `{place_id, slug, default_locale}`. El wrapper TS (S2) parsea con
--    Zod. Agregar campos en V2 (e.g. `place_id` adicional para SSO)
--    requiere ALTER de la función + bump del shape — atómico, no roto.
-- 7. **EXECUTE concedido SÓLO a `app_system`** (REVOKE FROM PUBLIC +
--    GRANT TO app_system): rol PUBLIC nunca puede invocarla, ni siquiera
--    si Neon agregara un nuevo rol de tercero. `app_system` es el rol
--    runtime canónico (ADR-0011).
-- 8. **Host inexistente / no-verified / archivado → NULL** (no exception):
--    el caller (`custom-domain-lookup.ts`, S2) trata NULL = "no es custom
--    domain conocido" → marketing fallback. Sin información lateral
--    (no distingue "no existe" de "archivado" — desde afuera son idénticos
--    a propósito).
--
-- ## Reverse SQL (rollback puntual)
--
--   REVOKE EXECUTE ON FUNCTION app.lookup_place_by_domain(text) FROM "app_system";
--   DROP FUNCTION IF EXISTS app.lookup_place_by_domain(text);
--
-- Sin caveats: la función es read-only, no deja efecto residual.
CREATE OR REPLACE FUNCTION app.lookup_place_by_domain(p_host text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'place_id', p.id,
    'slug', p.slug,
    'default_locale', p.default_locale
  )
  FROM place_domain pd
  JOIN place p ON p.id = pd.place_id
  WHERE lower(pd.domain) = lower(p_host)
    AND pd.verified_at IS NOT NULL
    AND pd.archived_at IS NULL
    AND p.archived_at IS NULL
  LIMIT 1;
$$;--> statement-breakpoint
-- EXECUTE solo `app_system` (no PUBLIC): la lookup nunca es invocable por
-- un rol no previsto. Idempotente (drizzle re-aplica en cada branch nuevo).
REVOKE EXECUTE ON FUNCTION app.lookup_place_by_domain(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.lookup_place_by_domain(text) TO "app_system";
