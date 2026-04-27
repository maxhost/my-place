/**
 * API pública del slice `shell`. Único punto de entrada desde otras
 * partes del sistema. Ver `docs/architecture.md` § boundaries.
 *
 * Slice puro UI: no expone queries propias (consume `listMyPlaces` de
 * `places/public` desde el layout que lo monta). No requiere split
 * `public.server.ts` porque ningún export tiene `import 'server-only'`.
 */

export { AppShell } from './ui/app-shell'
export { ZoneFab } from './ui/zone-fab'
export { ZoneSwiper } from './ui/zone-swiper'
export { ZONES, deriveActiveZone, type Zone, type ZoneIndex } from './domain/zones'
