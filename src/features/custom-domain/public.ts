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
// COMPONENTES PÚBLICOS:
//
//   - **3 Server Actions** (las dos primeras `"use server"`; la última es
//     helper-server invocado directo desde el page Server Component —
//     lazy verification, ADR-0026 §1):
//       - `registerCustomDomainAction(input)`: Zod → validate → JWT → tx
//         INSERT → Vercel.addDomain → rollback best-effort → revalidatePath.
//       - `archiveCustomDomainAction(input)`: Zod → JWT → UPDATE archived_at
//         con double-check slug-match → Vercel.removeDomain best-effort →
//         revalidatePath.
//       - `getCustomDomainStatus(placeId)`: SELECT fila activa → si pending,
//         GET Vercel → si verified persistir `verified_at = now()` → retorna
//         `CustomDomainState`.
//   - **`<DomainSection>`** Client Component (3 estados none/pending/verified
//     + form + tabla DNS + confirm dialog + auto-refresh 30s) +
//     `DomainSectionLabels` (~33 keys del bloque i18n `placeSettings.domain.*`,
//     paridad ×6 locales via `scripts/check-translations.mjs`).
//   - **Types del dominio**: `CustomDomainStatus`, `CustomDomainState`
//     (discriminated union), `CustomDomainRecord`, `DnsRecord`,
//     `RegisterError`, `ArchiveError`, `RegisterCustomDomainResult`,
//     `ArchiveCustomDomainResult`, y firmas de los actions.
//
// CONSUMERS V1:
//   - `src/app/(app)/place/[placeSlug]/settings/domain/page.tsx` — page
//     Server Component que orquesta el cableado: SSR del estado lazy +
//     inyección de los 2 actions + labels resueltas via `getTranslations`.
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
