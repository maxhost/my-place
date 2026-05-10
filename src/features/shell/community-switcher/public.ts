/**
 * API pública del sub-slice `community-switcher`.
 *
 * Sub-slice de `features/shell` (ver ADR
 * `docs/decisions/2026-05-10-shell-sub-slices.md`). Patrón:
 * `docs/decisions/2026-05-08-sub-slice-cross-public.md`.
 *
 * Consumers internos de `features/shell` (ej. `top-bar.tsx`) importan via
 * `../community-switcher/public`. Otros features que necesiten el switcher
 * pueden importar via `@/features/shell/community-switcher/public`.
 */

export { CommunitySwitcher } from './ui/community-switcher'
export { CommunityRow } from './ui/community-row'
