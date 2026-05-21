// Interfaz pública del slice `place` (paradigma vertical-slice
// `docs/architecture.md` §17-25 + ADR-0023): los demás features / rutas
// importan SÓLO desde acá, nunca de internos.
//
// S3 del feature `settings` (`docs/features/settings/spec.md`):
// - `loadPlaceBySlug(executor, slug)`: query DB-bound owner-only (RLS
//   `place_sel`). Consumer principal: el page del settings y su layout
//   (S6) — el JWT del caller activa la policy, no-owners reciben `null`.
// - `PlaceData`, `PlaceLocale`: tipos del dominio del slice.
// - `PLACE_LOCALES`: universo cerrado de locales operativos (ADR-0022 +
//   ADR-0024). Útil para guards/iteraciones desde consumers.

export { loadPlaceBySlug } from "./queries/load-place-by-slug";
export {
  PLACE_LOCALES,
  type PlaceData,
  type PlaceLocale,
} from "./domain/place-data";
