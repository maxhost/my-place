/**
 * Invariantes del slice `library` (R.7.2).
 *
 * Funciones puras — sin Prisma, sin Next, sin React. Lanzan
 * `ValidationError` o `CategoryLimitReachedError` (de `errors.ts`)
 * cuando un input no respeta las reglas.
 *
 * Los CHECK constraints en migration 20260430000000 son defensa en
 * profundidad de los mismos invariants — si un bug del server saltea
 * estas validaciones, Postgres rechaza el insert.
 *
 * Ver `docs/features/library/spec.md` § 10.
 */

import { ValidationError } from '@/shared/errors/domain-error'
import { CategoryLimitReachedError } from './errors'
import { CONTRIBUTION_POLICY_VALUES, type ContributionPolicy } from './types'

// ---------------------------------------------------------------
// Constantes del dominio
// ---------------------------------------------------------------

export const CATEGORY_TITLE_MIN_LENGTH = 1
export const CATEGORY_TITLE_MAX_LENGTH = 60
export const CATEGORY_EMOJI_MIN_LENGTH = 1
export const CATEGORY_EMOJI_MAX_LENGTH = 8
export const CATEGORY_SLUG_MAX_LENGTH = 80

/**
 * Cap por place para evitar que el grid de categorías se vuelva
 * scroll infinito que rompe principios CLAUDE.md ("nada parpadea").
 * 30 cubre con margen casos reales (un place pyme rara vez supera 10).
 * Si producto pide más, repensar UX antes de subir el cap.
 */
export const MAX_CATEGORIES_PER_PLACE = 30

// ---------------------------------------------------------------
// Title
// ---------------------------------------------------------------

export function validateCategoryTitle(title: string): void {
  const trimmed = title.trim()
  if (trimmed.length < CATEGORY_TITLE_MIN_LENGTH) {
    throw new ValidationError('El título de la categoría no puede estar vacío.', {
      length: trimmed.length,
    })
  }
  if (trimmed.length > CATEGORY_TITLE_MAX_LENGTH) {
    throw new ValidationError(
      `El título no puede superar ${CATEGORY_TITLE_MAX_LENGTH} caracteres.`,
      { length: trimmed.length },
    )
  }
}

// ---------------------------------------------------------------
// Emoji
// ---------------------------------------------------------------

/**
 * Valida que `emoji` sea un string corto (1..8 chars) — los emojis
 * compuestos (familias, banderas, ZWJ sequences) pueden superar 1
 * code point. No validamos que SEA emoji propiamente dicho — eso es
 * pesado (regex Unicode property escapes con tabla completa) y la
 * UI ya pasa solo emojis vía picker. CHECK SQL backstops a nivel DB.
 */
export function validateCategoryEmoji(emoji: string): void {
  if (emoji.length < CATEGORY_EMOJI_MIN_LENGTH) {
    throw new ValidationError('Falta el emoji de la categoría.', { length: emoji.length })
  }
  if (emoji.length > CATEGORY_EMOJI_MAX_LENGTH) {
    throw new ValidationError(
      `El emoji no puede superar ${CATEGORY_EMOJI_MAX_LENGTH} caracteres.`,
      { length: emoji.length },
    )
  }
}

// ---------------------------------------------------------------
// Slug (formato kebab-case)
// ---------------------------------------------------------------

/**
 * Regex idéntica al CHECK constraint del migration: solo lowercase
 * a-z, dígitos 0-9, guiones simples internos (no leading/trailing,
 * no consecutivos). Sin acentos ni caracteres no-ASCII — el slug se
 * deriva del título normalizado por `generateLibraryCategorySlug`.
 */
export const CATEGORY_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function validateCategorySlug(slug: string): void {
  if (slug.length < 1 || slug.length > CATEGORY_SLUG_MAX_LENGTH) {
    throw new ValidationError(
      `El slug debe tener entre 1 y ${CATEGORY_SLUG_MAX_LENGTH} caracteres.`,
      { length: slug.length },
    )
  }
  if (!CATEGORY_SLUG_REGEX.test(slug)) {
    throw new ValidationError('El slug solo puede contener minúsculas, dígitos y guiones.', {
      slug,
    })
  }
}

// ---------------------------------------------------------------
// Contribution policy
// ---------------------------------------------------------------

export function validateContributionPolicy(policy: string): asserts policy is ContributionPolicy {
  if (!CONTRIBUTION_POLICY_VALUES.includes(policy as ContributionPolicy)) {
    throw new ValidationError('Política de contribución inválida.', { policy })
  }
}

// ---------------------------------------------------------------
// Cap de categorías
// ---------------------------------------------------------------

export function assertCategoryCapacity(currentCount: number): void {
  if (currentCount >= MAX_CATEGORIES_PER_PLACE) {
    throw new CategoryLimitReachedError({
      currentCount,
      max: MAX_CATEGORIES_PER_PLACE,
    })
  }
}

// ---------------------------------------------------------------
// Item invariants (R.7.6+)
// ---------------------------------------------------------------

/**
 * Cap defensivo de `coverUrl`. Más amplio que un slug porque las
 * URLs de imágenes pueden tener query strings largos (presigned
 * URLs de Drive/Dropbox/etc.). Mismo orden que el límite del Post.
 */
export const ITEM_COVER_URL_MAX_LENGTH = 2000

/**
 * Caps de título del item. El item es un Post (R.7.6+) y el server
 * valida con POST_TITLE_* de discussions. Replicamos los valores acá
 * para que la UI client-side no arrastre `discussions/public` (que
 * tiene exports server-only y rompe el bundle cliente). Si el cap
 * cambia en discussions, hay que actualizar acá también — los
 * mantengo en sync explícitamente.
 */
export const ITEM_TITLE_MIN_LENGTH = 1
export const ITEM_TITLE_MAX_LENGTH = 160

/**
 * Valida que `coverUrl` sea un http(s):// válido y no exceda el cap.
 * Retorna sin error si es null (cover opcional).
 */
export function validateItemCoverUrl(url: string | null | undefined): void {
  if (url === null || url === undefined) return
  const trimmed = url.trim()
  if (trimmed.length === 0) return
  if (trimmed.length > ITEM_COVER_URL_MAX_LENGTH) {
    throw new ValidationError(`La URL del cover supera ${ITEM_COVER_URL_MAX_LENGTH} caracteres.`, {
      length: trimmed.length,
    })
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new ValidationError('La URL del cover debe comenzar con http:// o https://.', {
      url: trimmed,
    })
  }
}
