/**
 * API pública del sub-slice `zone-fab`.
 *
 * Sub-slice de `features/shell` (ver ADR
 * `docs/decisions/2026-05-10-shell-sub-slices.md`).
 *
 * El consumer principal es `app/[placeSlug]/(gated)/layout.tsx` que monta
 * `<ZoneFab>` como sibling del `<ZoneSwiper>`. Otros consumers via el
 * re-export en `features/shell/public.ts` (backwards compat).
 */

export { ZoneFab } from './ui/zone-fab'
