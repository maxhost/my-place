// Interfaz pública del slice `custom-domain` (paradigma vertical-slice
// `docs/architecture.md` §17-25: los consumers — page del settings, future
// host-routing edge, future OIDC callback — importan SÓLO desde acá, nunca
// de internals).
//
// V1 (`docs/features/custom-domain/spec.md` + `docs/decisions/0026-custom-
// domain-v1-lazy-verification.md`): registro + verificación lazy + archive
// del dominio propio del place. Promovido a slice propio en S4.5 cuando el
// LOC del slice anfitrión `place-settings` superó el cap (≤1500 de CLAUDE.md
// §Límites). Ver `docs/decisions/0028-custom-domain-slice-promotion.md`.
//
// COMPONENTES PÚBLICOS (post ADR-0030 — el lazy poll vive en el sub-slice
// `custom-domain-verification`; ver `@/features/custom-domain-verification/
// public` para `getCustomDomainStatus`):
//
//   - **2 Server Actions** (commands del owner, ambas `"use server"`):
//       - `registerCustomDomainAction(input)`: Zod → validate → JWT → tx
//         INSERT → Vercel.addDomain → V6 misconfigured check (ADR-0029) →
//         rollback best-effort → revalidatePath.
//       - `archiveCustomDomainAction(input)`: Zod → JWT → UPDATE archived_at
//         con double-check slug-match → Vercel.removeDomain best-effort →
//         revalidatePath.
//   - **`<DomainSection>`** Client Component (3 estados none/pending/verified
//     + form + tabla DNS + confirm dialog + auto-refresh 30s) +
//     `DomainSectionLabels` (~33 keys del bloque i18n `placeSettings.domain.*`,
//     paridad ×6 locales via `scripts/check-translations.mjs`).
//   - **Types del dominio** (consumidos también por `custom-domain-verification`
//     vía barrel cross-slice, ADR-0030): `CustomDomainStatus`,
//     `CustomDomainState` (discriminated union), `CustomDomainRecord`,
//     `DnsRecord`, `RegisterError`, `ArchiveError`,
//     `RegisterCustomDomainResult`, `ArchiveCustomDomainResult`, y firmas
//     de los actions.
//
// CONSUMERS V1:
//   - `src/app/(app)/place/[placeSlug]/settings/domain/page.tsx` — page
//     Server Component que orquesta el cableado: SSR del estado lazy
//     (`getCustomDomainStatus` desde `custom-domain-verification`) +
//     inyección de los 2 commands + labels resueltas via `getTranslations`.
//
// CANON Server Actions (`place-settings/actions/update-default-locale.ts:13`):
// sin vitest directo; cobertura via piezas puras (`validateCustomDomain`,
// `mapPgErrorToActionError`, wrapper Vercel) + tipo/build + smoke vivo S5.
//
// Lo que NO se exporta acá (intencional):
//   - `mapPgErrorToActionError`: helper interno; testeado vía relative
//     imports desde `__tests__/`.
//   - Sub-componentes UI internos (`PendingState`, `VerifiedState`,
//     `ArchiveTrigger`, `DnsRecordsTable`, etc.): privados; el consumer
//     interactúa sólo con `<DomainSection>`.
//   - `PlaceLocale`: vive en `@/features/place/public` (SoT).

export {
  DomainSection,
  type DomainSectionLabels,
} from "./ui/domain-section";

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

export {
  v6ConfigToDnsRecords,
  vercelRecordsToDnsRecords,
} from "./types/custom-domain";
