import { routing } from "@/i18n/routing";
import type { ThemeConfig } from "@/db/schema/json-shapes";

// Dominio del slice `place` (S3 del feature `settings`,
// `docs/features/settings/spec.md`). Tipos de la fila del place tal cual los
// consume el shell de la zona-place (`<NavPlaceLayout>` S5, settings page S6,
// `<LocaleSection>` S7). NO incluye campos billing/lifecycle (subscription_*,
// trial_ends_at, archived_at): el slice arranca con el subconjunto que las
// vistas del settings V1 necesitan; cuando una sección nueva pida un campo,
// se agrega acá (single source of truth del shape del slice).
//
// `PlaceLocale` está derivado de `routing.locales` (ADR-0024 §"6 locales
// operativos") para mantener un único SoT con el chrome del marketing/Hub.
// La invariante "el universo de locales del place ≡ universo de locales del
// chrome" está reforzada por el CHECK constraint de la columna
// `place.default_locale` (migration 0006, ADR-0022).

/** Universo cerrado de locales operativos (ADR-0022 + ADR-0024). */
export const PLACE_LOCALES = routing.locales;

/** Locale del chrome del place — editable por owner (ADR-0022). */
export type PlaceLocale = (typeof PLACE_LOCALES)[number];

/** Subconjunto de columnas de `place` que el feature `settings` V1 consume. */
export type PlaceData = {
  id: string;
  slug: string;
  name: string;
  defaultLocale: PlaceLocale;
  themeConfig: ThemeConfig;
};
