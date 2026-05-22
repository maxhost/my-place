-- Feature B — Custom Domain Routing V1 · S4b (ADR-0031 §"Fuente 2 — slug
-- canónico anonymous", 2026-05-22).
--
-- Lookup ANONYMOUS del `default_locale` del place identificado por slug.
-- Cierra el "Bug 1" del audit S4: el layout `(app)/place/[placeSlug]/` resuelve
-- `<html lang>` vía `place.default_locale`, pero `getPlaceForZone` retorna
-- `null` cuando el caller no es owner (RLS owner-only en `place`). Resultado
-- pre-S4b: visitor anónimo en subdomain canon (`mi-place.place.community/`)
-- ve el chrome en `routing.defaultLocale` ('es') aunque el owner configuró
-- 'pt'. S4b añade el lookup anonymous-safe — el layout lo usa como precedence
-- 2 entre `place.default_locale` (owner) y la cookie `NEXT_LOCALE`
-- cross-subdomain (S4a) / `routing.defaultLocale` (fallback).
--
-- Espejo estructural de 0009 (`app.lookup_place_by_domain`): mismo pattern
-- DEFINER, mismo header de invariantes, mismo ACL. Difiere sólo en:
--   - input: slug en lugar de host (sin strip de port).
--   - tabla origen: `place` directo (no JOIN con `place_domain`).
--   - return: `text` (locale escalar) en lugar de `jsonb` (payload).
--
-- ## Por qué SECURITY DEFINER
--
-- `place` tiene RLS owner-only via `place_ownership` (policies `place_sel/upd/
-- del` en schema/index.ts:122-124). Un caller sin claim (visitor anónimo en
-- subdomain canon, sin sesión Neon Auth) no matchea ninguna policy → 0 rows.
-- DEFINER + dueño `neondb_owner` (BYPASSRLS) habilita el SELECT anonymous
-- SIN ampliar superficie: la función filtra por `archived_at IS NULL` y
-- devuelve ÚNICAMENTE el `default_locale` — no expone slug, id, billing,
-- subscription_status, theme_config, ni ninguna otra columna sensible. El
-- locale es información pública por definición (lo ve cualquier visitor en
-- `<html lang>` + textos renderizados de la portada).
--
-- ## Invariantes
--
-- 1. **search_path fijo** (`public, pg_temp`): anti-hijack obligatorio en
--    DEFINER. Si un caller cambia el search_path, las refs sin schema
--    quoting siguen apuntando a `public.place`.
-- 2. **STABLE**: no modifica DB, sólo lee. Habilita inlining del optimizer.
-- 3. **lower(slug) = lower(p_slug)**: case-insensitive match. El registro
--    de slugs vía `app.create_place` (0002/0007) ya normaliza a lowercase
--    en la app layer (`features/onboarding`); defense-in-depth.
-- 4. **`AND p.archived_at IS NULL`**: un place archivado por owner deja de
--    rutear su locale. Mantiene paridad con 0009 (`p.archived_at IS NULL`)
--    y con la convención canónica de tombstoning (ADR-0003).
-- 5. **`LIMIT 1`**: `place.slug` es `UNIQUE` (schema/index.ts:89). Garantía
--    a lo sumo 1 fila. LIMIT 1 = defense-in-depth ante drift improbable
--    (paralelo a 0009).
-- 6. **Return `text` (no jsonb)**: el shape es 1 escalar; envolver en jsonb
--    sólo agrega ceremonia. El wrapper TS (S4b §wrapper) parsea con
--    `z.enum` el conjunto cerrado de locales — defense-in-depth ante el
--    CHECK constraint `place_default_locale_check`.
-- 7. **EXECUTE concedido SÓLO a `app_system`** (REVOKE FROM PUBLIC +
--    GRANT TO app_system): rol PUBLIC nunca puede invocarla. `app_system`
--    es el rol runtime canónico (ADR-0011); ya tiene `USAGE` sobre
--    `schema app` desde 0000.
-- 8. **Slug inexistente / archivado → NULL** (no exception): el caller
--    (`place-locale-lookup.ts`, S4b §wrapper) trata NULL = "no hay locale
--    conocido para este slug" → layout cae a precedence 3
--    (`routing.defaultLocale`). Sin información lateral (no distingue
--    "no existe" de "archivado" — desde afuera son idénticos a propósito).
-- 9. **NO se expone existencia del slug per se**: el lookup confirma slug
--    válido (la URL pública del subdomain canon ya hace eso desde un
--    browser); el único campo retornado es el locale. Cero leak adicional.
--
-- ## Reverse SQL (rollback puntual)
--
--   REVOKE EXECUTE ON FUNCTION app.lookup_place_locale_by_slug(text) FROM "app_system";
--   DROP FUNCTION IF EXISTS app.lookup_place_locale_by_slug(text);
--
-- Sin caveats: la función es read-only, no deja efecto residual.
CREATE OR REPLACE FUNCTION app.lookup_place_locale_by_slug(p_slug text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.default_locale
  FROM place p
  WHERE lower(p.slug) = lower(p_slug)
    AND p.archived_at IS NULL
  LIMIT 1;
$$;--> statement-breakpoint
-- EXECUTE solo `app_system` (no PUBLIC): la lookup nunca es invocable por
-- un rol no previsto. Idempotente (drizzle re-aplica en cada branch nuevo).
REVOKE EXECUTE ON FUNCTION app.lookup_place_locale_by_slug(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.lookup_place_locale_by_slug(text) TO "app_system";
