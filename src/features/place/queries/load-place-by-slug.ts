import type { SqlExecutor } from "@/shared/lib/db";
import type { ThemeConfig } from "@/db/schema/json-shapes";
import {
  PLACE_LOCALES,
  type PlaceData,
  type PlaceLocale,
} from "../domain/place-data";

// Wrapper de la query SELECT del place por slug. El page del settings
// (`/place/[placeSlug]/settings/`, S6) lo invoca dentro de
// `getAuthenticatedDb(token, ...)` — el `SqlExecutor` ya viene con el claim
// del caller inyectado tx-local. Owner-only V1 (ADR-0022, spec.md
// §"Auth + redirects"): si el caller no es owner del place → `null`. Si es
// owner pero el place está archivado (`archived_at NOT NULL`) → `null`.
//
// Sobre el filtro owner: la policy `place_sel` (RLS) hoy permite SELECT a
// **owner OR active member** — fue reescrita por la migration 0004
// (`member_read.sql`) cuando se habilitó la zona-place para miembros
// (`docs/multi-tenancy.md`). El feature `settings` sigue siendo owner-only
// (decisión de dominio independiente de la RLS), por lo que la query agrega
// un EXISTS explícito sobre `place_ownership`. La RLS protege contra
// outsiders (no-member); el EXISTS protege contra members-no-owner. Doble
// red, defense-in-depth — el slice no asume que `place_sel` sea owner-only.
//
// NO usa stored function (a diferencia del Hub, ADR-0021): es un SELECT
// trivial sobre una tabla con un EXISTS bien afinado; meterlo en una
// function SECURITY INVOKER sería peso muerto. El alias `AS "defaultLocale"`
// / `AS "themeConfig"` hace la conversión snake_case→camelCase en la propia
// query — más limpio que un parser TS adicional.

// Shape crudo de las columnas alias-eadas en la SELECT. El SqlExecutor
// devuelve `Record<string, unknown>[]`; lo tipamos acá para el cast localmente.
type LoadedPlaceRow = {
  id: string;
  slug: string;
  name: string;
  defaultLocale: string;
  themeConfig: ThemeConfig;
};

function isPlaceLocale(value: string): value is PlaceLocale {
  return (PLACE_LOCALES as readonly string[]).includes(value);
}

/**
 * Carga el place por `slug` aplicando el guard owner-only del settings.
 * Retorna `null` si: (a) el slug no existe, (b) el caller no es owner del
 * place (incluye no-member y member-no-owner), o (c) el place está
 * archivado (`archived_at NOT NULL`).
 *
 * El `executor` debe venir de `getAuthenticatedDb(token, …)` — el claim del
 * caller activa la RLS de `place_sel` y alimenta el EXISTS sobre
 * `place_ownership` (vía `app.current_user_id()`). Llamar con un executor
 * sin claim NO retorna error: el EXISTS evalúa false, devuelve `null` — los
 * call-sites tratan `null` como "no autorizado / no existe" (UX: 404).
 */
export async function loadPlaceBySlug(
  executor: SqlExecutor,
  slug: string,
): Promise<PlaceData | null> {
  const rows = (await executor(
    `SELECT p.id, p.slug, p.name,
            p.default_locale AS "defaultLocale",
            p.theme_config   AS "themeConfig"
       FROM place p
      WHERE p.slug = $1
        AND p.archived_at IS NULL
        AND EXISTS (
          SELECT 1 FROM place_ownership po
            JOIN app_user au ON au.id = po.user_id
           WHERE po.place_id = p.id
             AND au.auth_user_id = (SELECT app.current_user_id())
        )
      LIMIT 1`,
    [slug],
  )) as LoadedPlaceRow[];
  if (rows.length === 0) return null;
  const row = rows[0];
  if (!isPlaceLocale(row.defaultLocale)) {
    // Drift entre el CHECK constraint de la DB y el universo de PLACE_LOCALES.
    // Fail-loud (no fail-silent): señal clara de que se agregó un locale en
    // DB sin actualizar `routing.locales` (o viceversa). Mismo principio que
    // el wrapper del Hub (ADR-0021 §"PlaceStatus desconocido").
    throw new Error(
      `PlaceLocale desconocido recibido de la DB: ${row.defaultLocale}`,
    );
  }
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    defaultLocale: row.defaultLocale,
    themeConfig: row.themeConfig,
  };
}
