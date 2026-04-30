/**
 * Errores específicos del slice `library` (R.7.2).
 *
 * Extienden `DomainError` para mantener consistencia con el resto del
 * codebase (mismo patrón que `events/domain/errors.ts` y
 * `discussions/domain/errors.ts`). El UI mapper convierte estos
 * errores a copy user-facing en español (ver `library/ui/errors.ts`
 * cuando R.7.3 lo cree).
 *
 * Ver `docs/features/library/spec.md` § 10.
 */

import { DomainError } from '@/shared/errors/domain-error'

/**
 * El place alcanzó el cap de categorías (`MAX_CATEGORIES_PER_PLACE`,
 * default 30). Lanzado por `assertCategoryCapacity` antes de crear.
 * Mensaje user-facing: "Tu biblioteca llegó al máximo de categorías.
 * Archivá alguna antes de crear una nueva."
 */
export class CategoryLimitReachedError extends DomainError {
  constructor(context: { currentCount: number; max: number }) {
    super(
      'LIBRARY_CATEGORY_LIMIT_REACHED',
      `La biblioteca alcanzó el máximo de ${context.max} categorías.`,
      context,
    )
  }
}

/**
 * Conflicto de slug al crear o resolver una categoría — el espacio
 * de slugs colisionó después de N reintentos (raro, pero defensivo).
 * Mismo patrón que `SlugCollisionExhausted` en discussions.
 */
export class CategorySlugCollisionError extends DomainError {
  constructor(context: { title: string; candidate: string; attemptedSuffixes: number }) {
    super(
      'LIBRARY_CATEGORY_SLUG_COLLISION',
      'No se pudo generar un slug único para la categoría.',
      context,
    )
  }
}
