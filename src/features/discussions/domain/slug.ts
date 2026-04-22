/**
 * Slugs de Post: URL segment derivado del título.
 *
 * Reglas (spec §13):
 *   - Se fija al crear; edits de título dentro de los 60s NO regeneran.
 *   - Único por `(placeId, slug)` — colisiones se resuelven con sufijo numérico.
 *   - Reserved set evita colisionar con rutas del producto (`/settings`, `/m/...`).
 *
 * Este módulo es puro (sin I/O). `createPostAction` es el único que conoce la
 * DB y combina `RESERVED_POST_SLUGS` con las filas existentes que empiezan con
 * el slug candidato.
 */

export const RESERVED_POST_SLUGS: ReadonlySet<string> = new Set([
  'settings',
  'm',
  'conversations',
  'new',
  'create',
  'edit',
  'drafts',
  'admin',
  'flags',
  'moderation',
  'null',
  'undefined',
])

const MAX_SLUG_LENGTH = 80
const DEFAULT_FALLBACK = 'tema'
const MAX_COLLISION_SUFFIX = 1000

export interface GeneratePostSlugOptions {
  reserved?: ReadonlySet<string>
  fallback?: string
}

export function generatePostSlug(title: string, opts: GeneratePostSlugOptions = {}): string {
  const base = normalizeTitleToSlug(title)
  const fallback = opts.fallback ?? DEFAULT_FALLBACK
  const candidate = base || fallback
  const reserved = opts.reserved ?? RESERVED_POST_SLUGS
  if (!reserved.has(candidate)) return candidate
  for (let n = 2; n < MAX_COLLISION_SUFFIX; n++) {
    const withSuffix = `${candidate}-${n}`
    if (!reserved.has(withSuffix)) return withSuffix
  }
  throw new Error(
    `generatePostSlug: imposible asignar slug tras ${MAX_COLLISION_SUFFIX} intentos para "${title}"`,
  )
}

function normalizeTitleToSlug(title: string): string {
  const normalized = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (normalized.length <= MAX_SLUG_LENGTH) return normalized
  const truncated = normalized.slice(0, MAX_SLUG_LENGTH)
  const lastDash = truncated.lastIndexOf('-')
  // Si el último segmento del truncado es muy corto (≤3 chars) probablemente
  // es un resto de palabra cortada — recortamos hasta el dash previo.
  if (lastDash > 0 && truncated.length - lastDash <= 3) {
    return truncated.slice(0, lastDash)
  }
  return truncated
}
