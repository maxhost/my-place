/**
 * API pública del sub-slice `settings-nav`.
 *
 * Sub-slice de `features/shell` (ver ADR
 * `docs/decisions/2026-05-10-shell-sub-slices.md`).
 *
 * El consumer principal es `app/[placeSlug]/settings/layout.tsx` que monta
 * `<SettingsNavFab>`. `<SettingsTrigger>` se monta desde el TopBar cuando el
 * viewer es admin/owner.
 *
 * Nota sobre el plan settings desktop redesign
 * (`docs/plans/2026-05-10-settings-desktop-redesign.md`): Sub-sesión 1c
 * va a tocar `settings-nav-fab.tsx` (md:hidden wrapper) y Sesión 6
 * (Frequently Accessed hub) puede agregar más componentes acá. Aislar el
 * sub-slice antes prepara terreno limpio.
 */

export { SettingsNavFab } from './ui/settings-nav-fab'
export { SettingsTrigger } from './ui/settings-trigger'
export {
  SETTINGS_SECTIONS,
  deriveVisibleSettingsSections,
  deriveActiveSettingsSection,
  type SettingsSection,
  type SettingsSectionSlug,
} from './domain/settings-sections'
