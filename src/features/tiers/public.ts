/**
 * API pública del slice `tiers` (T.2 + T.3 + T.4).
 *
 * Lo que viaja al bundle cliente: tipos, helpers puros, invariantes,
 * Server Action references (Next serializa los actions como
 * referencias — no son código en cliente). Para queries Prisma usar
 * `public.server.ts`.
 *
 * Ver `docs/features/tiers/spec.md` y `docs/decisions/2026-05-02-tier-model.md`.
 */

// ---------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------

export type { Tier, TierCurrency, TierDuration, TierVisibility } from './domain/types'

export { TIER_CURRENCY_VALUES, TIER_DURATION_VALUES, TIER_VISIBILITY_VALUES } from './domain/types'

// ---------------------------------------------------------------
// Duration helpers — puros, tree-shakeable, sin server deps
// ---------------------------------------------------------------

export { tierDurationLabel, tierDurationToDays } from './domain/duration'

// ---------------------------------------------------------------
// Invariants — útiles para hints/length caps en la UI
// ---------------------------------------------------------------

export {
  TIER_DESCRIPTION_MAX_LENGTH,
  TIER_NAME_MAX_LENGTH,
  TIER_NAME_MIN_LENGTH,
  TIER_PRICE_CENTS_MAX,
  TIER_PRICE_CENTS_MIN,
} from './domain/invariants'

// ---------------------------------------------------------------
// Server actions (T.3) — references viajan client-safe
// ---------------------------------------------------------------

export { createTierAction } from './server/actions/create-tier'
export { setTierVisibilityAction } from './server/actions/set-tier-visibility'
export { updateTierAction } from './server/actions/update-tier'

// ---------------------------------------------------------------
// UI (T.4) — Client orchestrator + form sheet (ambos client-safe)
// ---------------------------------------------------------------
//
// Re-diseño 2026-05-03 alineado a `docs/ux-patterns.md`:
//  - `<TiersListAdmin>` es ahora el orquestador Client único — incluye
//    sección + heading + lista + empty state + dashed-border CTA + sheet
//    de form + dropdown 3-dot por row. Reemplaza al ensamblaje previo
//    `<TiersListAdmin>` (RSC) + `<TierCard>` + `<EmptyTiers>` +
//    `<VisibilityToggle>` + `<TierFormDialog>`.
//  - `<TierFormSheet>` se exporta para callers que necesiten montarlo
//    fuera del orquestador (no hay caller actual, pero la API del slice
//    documenta que el sheet es la primitive — el orchestrator es la
//    composición canónica).

export { TierDetailPanel } from './ui/tier-detail-panel'
export { TierFormSheet } from './ui/tier-form-sheet'
export { TiersListAdmin } from './ui/tiers-list-admin'
export { friendlyTierErrorMessage } from './ui/errors'
