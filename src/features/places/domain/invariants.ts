import { InvariantViolation, ValidationError } from '@/shared/errors/domain-error'
import { isReservedSlug } from '@/shared/config/reserved-slugs'

/**
 * Invariantes del slice `places`. Ver `docs/features/places/spec.md` § "Slug".
 * Funciones puras, sin DB ni side effects — la barrera real de unicidad es la constraint de Postgres.
 */

export const SLUG_REGEX = /^[a-z0-9-]+$/
export const SLUG_MIN = 3
export const SLUG_MAX = 30

export function assertSlugFormat(slug: string): void {
  if (
    slug.length < SLUG_MIN ||
    slug.length > SLUG_MAX ||
    !SLUG_REGEX.test(slug) ||
    slug.startsWith('-') ||
    slug.endsWith('-') ||
    slug.includes('--')
  ) {
    throw new ValidationError('El slug tiene formato inválido.', {
      slug,
      expected: `minúsculas/dígitos/guiones, ${SLUG_MIN}-${SLUG_MAX} chars, sin guiones al borde ni dobles.`,
    })
  }
}

export function assertSlugNotReserved(slug: string): void {
  if (isReservedSlug(slug)) {
    throw new ValidationError('Ese slug está reservado para el sistema.', { slug })
  }
}

/**
 * Un place nunca puede quedar sin owners. Se chequea dentro de la tx de
 * leave/transfer, después de tomar el lock `FOR UPDATE` sobre `PlaceOwnership`.
 * Ver `docs/features/members/spec.md` § "Salir" y "Transferir ownership".
 */
export function assertMinOneOwner(ownershipCountAfter: number, context: { placeId: string }): void {
  if (ownershipCountAfter < 1) {
    throw new InvariantViolation('Un place debe tener al menos un owner.', {
      ownershipCountAfter,
      ...context,
    })
  }
}
