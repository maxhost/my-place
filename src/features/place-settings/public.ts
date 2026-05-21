// Interfaz pública del slice `place-settings` (paradigma vertical-slice
// `docs/architecture.md` §17-25: los demás features / rutas importan SÓLO
// desde acá, nunca de internals).
//
// V1 (S7 del feature `settings`, `docs/features/settings/spec.md`): primera
// sección funcional del settings owner-only — cambiar `place.default_locale`
// desde `{slug}.place.community/settings`. El slice expone:
//
//   - `<LocaleSection>`: Client Component del form (select de 6 endonyms +
//     submit + idempotencia). El page del settings (S6) lo monta dentro de
//     `<NavPlaceLayout>` pasando `currentLocale = place.defaultLocale` y la
//     action inyectada por seam-split.
//   - `LocaleSectionLabels`: contrato de textos serializable (sin runtime
//     i18n del lado del Client — mismo ethos que el wizard / access).
//   - `updateDefaultLocaleAction`: Server Action que valida con zod, requiere
//     sesión, y corre `UPDATE place SET default_locale = $1 WHERE slug = $2`
//     contra Neon vía `getAuthenticatedDb` (RLS `place_upd` owner-only,
//     ADR-0010 + defense-in-depth con `RETURNING id`).
//   - `UpdateDefaultLocaleInput/Result/UpdateDefaultLocale`: tipos del action
//     para que el page tipie la inyección sin importar de `actions/*` interno.
//
// V1.1 — sección Dominio (feature custom-domain V1, ADR-0026 +
// `docs/features/custom-domain/spec.md`). Slice sub-feature `domain/`:
//
//   - 3 Server Actions: `registerCustomDomainAction`,
//     `archiveCustomDomainAction`, `getCustomDomainStatus` (las dos
//     primeras `"use server"`; la última es helper-server invocado directo
//     desde el page Server Component — lazy verification, ADR-0026 §1).
//   - Types del dominio del slice: `CustomDomainStatus`, `CustomDomainState`
//     (discriminated union para la UI), `CustomDomainRecord`, `DnsRecord`,
//     `RegisterError`, `ArchiveError`, `RegisterCustomDomainResult`,
//     `ArchiveCustomDomainResult`, y firmas de los actions.
//   - `<DomainSection>` Client Component + `DomainSectionLabels`: pendiente
//     S4 (no exportado todavía).
//
// CANON Server Actions (`update-default-locale.ts:13`): sin vitest directo;
// la cobertura va por piezas puras (`validateCustomDomain`,
// `mapPgErrorToActionError`, wrapper Vercel) + tipo/build + smoke vivo.
//
// Lo que NO se exporta acá (intencional):
//   - `PlaceLocale`: vive en `@/features/place/public` (slice `place` es el
//     SoT del tipo). Si consumers del settings necesitan el tipo, importan de
//     `place`, no de `place-settings` — mantiene el grafo acíclico claro.
//   - `mapPgErrorToActionError`: helper interno del slice, tiene su test
//     directo en `__tests__/custom-domain.test.ts` (imports relativos).
//   - Componentes internos del form (`fieldClass`, helpers): privados.

export {
  LocaleSection,
  type LocaleSectionLabels,
} from "./ui/locale-section";

export {
  updateDefaultLocaleAction,
  type UpdateDefaultLocale,
  type UpdateDefaultLocaleInput,
  type UpdateDefaultLocaleResult,
} from "./actions/update-default-locale";

export {
  registerCustomDomainAction,
  type RegisterCustomDomain,
  type RegisterCustomDomainInput,
} from "./actions/register-custom-domain";

export {
  archiveCustomDomainAction,
  type ArchiveCustomDomain,
  type ArchiveCustomDomainInput,
} from "./actions/archive-custom-domain";

export { getCustomDomainStatus } from "./actions/get-custom-domain-status";

export type {
  ArchiveCustomDomainResult,
  ArchiveError,
  CustomDomainRecord,
  CustomDomainState,
  CustomDomainStatus,
  DnsRecord,
  RegisterCustomDomainResult,
  RegisterError,
} from "./types/custom-domain";
