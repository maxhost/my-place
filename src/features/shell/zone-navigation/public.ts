/**
 * API pública del sub-slice `zone-navigation`.
 *
 * Sub-slice de `features/shell` (ver ADR
 * `docs/decisions/2026-05-10-shell-sub-slices.md`).
 *
 * Consumers internos del shell (`shell-chrome.tsx`, `zone-fab/`) y consumers
 * externos (`app/[placeSlug]/(gated)/layout.tsx`, hours form) importan via
 * este barrel.
 */

export { ZoneSwiper } from './ui/zone-swiper'
export { SwiperViewport } from './ui/swiper-viewport'
export { SectionDots } from './ui/section-dots'
export { ZONES, deriveActiveZone, type Zone, type ZoneIndex } from './domain/zones'
export {
  isZoneRootPath,
  shouldShowShellChrome,
  shouldRefreshZone,
  deriveSnapTarget,
} from './domain/swiper-snap'
