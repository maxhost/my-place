/**
 * Catálogo de secciones del área `/settings/*` del place.
 *
 * Single source of truth consumido por:
 *  - `<SettingsNavFab>` (UI) para listar items del menú admin.
 *  - `<SettingsTrigger>` (UI) para construir el href del button TopBar.
 *  - Tests unit que validan visibilidad/orden.
 *
 * Pure data sin dependencias de lucide-react ni Next: el slug navega
 * relative al subdomain del place, los iconos los resuelve la UI con
 * un mapping aparte (mantiene este archivo testeable sin DOM).
 *
 * **`requiredRole` (T.4)**: items que requieren un rol específico
 * (`'owner'` por ahora). Default ausente = visible a admin-or-owner
 * (comportamiento original). El gate vive en `deriveVisibleSettingsSections`,
 * no en el componente — facilita tests puros sin renderizar.
 *
 * Ver `docs/features/shell/spec.md` § "Settings affordances" y
 * `docs/features/tiers/spec.md` § 12.
 */

export const SETTINGS_SECTIONS = [
  { slug: '', label: 'General' },
  { slug: 'hours', label: 'Horarios' },
  { slug: 'library', label: 'Biblioteca' },
  // 'access' (admin-or-owner): invitar, pending invitations, transfer
  // ownership, salir, lista mini de miembros. Plan TierMemberships M.4.
  { slug: 'access', label: 'Acceso' },
  // 'members' rebautizado en plan TierMemberships M.4: ya no es la page
  // de invitar/leave (eso pasó a 'access'); ahora es el directorio
  // owner-only con search + filtros + click al detalle.
  { slug: 'members', label: 'Miembros', requiredRole: 'owner' },
  { slug: 'flags', label: 'Reportes' },
  // 'groups' (G.5): owner-only CRUD de grupos de permisos custom y preset
  // "Administradores". Reemplaza la noción de rol ADMIN — los admins se
  // migran al grupo preset.
  { slug: 'groups', label: 'Grupos', requiredRole: 'owner' },
  { slug: 'tiers', label: 'Tiers', requiredRole: 'owner' },
  // 'editor' (F.5 plan rich-text): owner-only toggles de los 4 plugins de
  // embed (YouTube, Spotify, Apple Podcasts, iVoox) que ofrece el composer.
  { slug: 'editor', label: 'Editor', requiredRole: 'owner' },
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]
export type SettingsSectionSlug = SettingsSection['slug']

/**
 * Filtra `SETTINGS_SECTIONS` según permisos del viewer.
 *
 * - Items sin `requiredRole` ⇒ siempre visibles (admin o owner que
 *   ya pasó el gate del layout).
 * - Items con `requiredRole: 'owner'` ⇒ visibles sólo si `ctx.isOwner`.
 * - Items con `requiredRole: 'admin'` ⇒ no se usa hoy; reservado.
 *
 * Función pura. Tests unit dedicados en `__tests__/settings-sections.test.ts`.
 */
export function deriveVisibleSettingsSections(ctx: {
  isOwner: boolean
}): readonly SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => {
    if ('requiredRole' in s && s.requiredRole === 'owner') return ctx.isOwner
    return true
  })
}

/**
 * Deriva el slug de la sub-page de settings activa a partir del pathname.
 *
 *  - `/settings` o `/settings/` → `''` (sección "General").
 *  - `/settings/hours` o `/settings/hours/` → `'hours'`.
 *  - `/settings/library/foo` → `'library'` (segmento extra ignorado;
 *    la sub-page library NO tiene sub-rutas hoy pero el matcher es
 *    permisivo para no romper si en el futuro las suma).
 *  - Pathname fuera de settings (`/`, `/conversations`, `/library/...`)
 *    → `null`. El caller usa esto para decidir si renderiza el FAB de
 *    nav o no.
 */
export function deriveActiveSettingsSection(pathname: string): SettingsSectionSlug | null {
  const match = pathname.match(/^\/settings(?:\/([^/]+))?\/?$/)
  if (match) {
    return (match[1] ?? '') as SettingsSectionSlug
  }
  // Permite sub-rutas profundas que sigan estando "dentro de settings/X".
  const deep = pathname.match(/^\/settings\/([^/]+)\//)
  if (deep) {
    return deep[1] as SettingsSectionSlug
  }
  return null
}
