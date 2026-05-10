/**
 * Zonas del shell. Cada zona es un dot en `<SectionDots>` con su path
 * canónico. R.5 sumó Biblioteca como 4ª zona — UI scaffold sin backend
 * todavía (ver `docs/features/library/spec.md`).
 *
 * El orden del array es el orden visual de los dots (left-to-right).
 *
 * Ver `docs/features/shell/spec.md` § 2 (vocabulario) y § 4 (routing).
 */

export type ZoneIndex = 0 | 1 | 2 | 3

export type Zone = {
  readonly index: ZoneIndex
  readonly label: string
  readonly path: string
}

export const ZONES: ReadonlyArray<Zone> = [
  { index: 0, label: 'Inicio', path: '/' },
  { index: 1, label: 'Conversaciones', path: '/conversations' },
  { index: 2, label: 'Eventos', path: '/events' },
  { index: 3, label: 'Biblioteca', path: '/library' },
] as const

/**
 * Deriva la zona activa a partir del `pathname` del browser.
 *
 * - `/` o solo `placeSlug` (rewrite del middleware) → 0 (Inicio)
 * - `/conversations` o `/conversations/...` → 1
 * - `/events` o `/events/...` → 2
 * - `/library` o `/library/...` → 3
 * - `/settings/*`, `/m/[userId]`, `/auth/*`, etc. → null (ningún dot
 *   activo, dots renderizan pero sin "current")
 *
 * Tolera trailing slash (`/conversations/` → 1).
 */
export function deriveActiveZone(pathname: string): ZoneIndex | null {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  if (normalized === '/') return 0
  if (normalized.startsWith('/conversations')) return 1
  if (normalized.startsWith('/events')) return 2
  if (normalized.startsWith('/library')) return 3
  return null
}
