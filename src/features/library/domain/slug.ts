/**
 * Slug helper para categorías de biblioteca.
 *
 * Idéntico patrón al `discussions/domain/slug.ts` pero parametrizado
 * para biblioteca: el slug se deriva del título y resuelve colisiones
 * por sufijo numérico. Inmutable post-creación (mismo principio que
 * Place.slug y Post.slug).
 *
 * Reservados: protegen rutas R.7+ del producto. La sub-page `new` y
 * `archived` (admin) entrarían en conflicto con `/library/[slug]` si
 * un admin elige título "New" o "Archived".
 *
 * Ver `docs/features/library/spec.md` § 10.
 */

import { CategorySlugCollisionError } from './errors'
import { CATEGORY_SLUG_MAX_LENGTH } from './invariants'

export const RESERVED_LIBRARY_CATEGORY_SLUGS: ReadonlySet<string> = new Set([
  'new',
  'archived',
  'settings',
  'edit',
  'admin',
  'search',
])

const DEFAULT_FALLBACK = 'categoria'
const MAX_COLLISION_SUFFIX = 1000

export interface GenerateLibraryCategorySlugOptions {
  /** Set adicional de slugs ya tomados (rows existentes en DB). El
   *  consumer SQL combina `RESERVED_*` con slugs del place. */
  reserved?: ReadonlySet<string>
  fallback?: string
}

export function generateLibraryCategorySlug(
  title: string,
  opts: GenerateLibraryCategorySlugOptions = {},
): string {
  const base = normalizeTitleToSlug(title)
  const fallback = opts.fallback ?? DEFAULT_FALLBACK
  const candidate = base || fallback
  const reserved = opts.reserved ?? RESERVED_LIBRARY_CATEGORY_SLUGS
  if (!reserved.has(candidate)) return candidate
  for (let n = 2; n < MAX_COLLISION_SUFFIX; n++) {
    const withSuffix = `${candidate}-${n}`
    if (!reserved.has(withSuffix)) return withSuffix
  }
  throw new CategorySlugCollisionError({
    title,
    candidate,
    attemptedSuffixes: MAX_COLLISION_SUFFIX,
  })
}

function normalizeTitleToSlug(title: string): string {
  const normalized = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (normalized.length <= CATEGORY_SLUG_MAX_LENGTH) return normalized
  const truncated = normalized.slice(0, CATEGORY_SLUG_MAX_LENGTH)
  const lastDash = truncated.lastIndexOf('-')
  if (lastDash > 0 && truncated.length - lastDash <= 3) {
    return truncated.slice(0, lastDash)
  }
  return truncated
}
