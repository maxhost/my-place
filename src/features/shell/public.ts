/**
 * API pública del slice `shell`. Único punto de entrada desde otras
 * partes del sistema. Ver `docs/architecture.md` § boundaries.
 *
 * Slice puro UI: no expone queries propias (consume `listMyPlaces` de
 * `places/public` desde el layout que lo monta). No requiere split
 * `public.server.ts` porque ningún export tiene `import 'server-only'`.
 */

export { AppShell } from './ui/app-shell'
export { SettingsNavFab } from './ui/settings-nav-fab'
export { ZoneFab } from './ui/zone-fab'
// Sub-slice re-exports (backwards compat — no romper consumers que importan
// desde @/features/shell/public). Nuevos consumers pueden importar directamente
// de @/features/shell/zone-navigation/public si prefieren.
export {
  ZoneSwiper,
  ZONES,
  deriveActiveZone,
  type Zone,
  type ZoneIndex,
} from './zone-navigation/public'
