'use server'

import { prisma } from '@/db/client'
import { AuthorizationError, ValidationError } from '@/shared/errors/domain-error'
import { logger } from '@/shared/lib/logger'
import { resolveActorForPlace } from '@/features/discussions/public.server'
import {
  RESERVED_LIBRARY_CATEGORY_SLUGS,
  generateLibraryCategorySlug,
} from '@/features/library/domain/slug'
import {
  assertCategoryCapacity,
  validateCategoryEmoji,
  validateCategorySlug,
  validateCategoryTitle,
} from '@/features/library/domain/invariants'
import { createCategoryInputSchema } from '@/features/library/schemas'
import { revalidateLibraryCategoryPaths } from './shared'

/**
 * Crea una nueva categoría de biblioteca.
 *
 * Flow:
 *  1. Parse Zod del input.
 *  2. Resuelve el actor (membership activa) — tira `AuthorizationError`
 *     si no hay sesión / no es miembro.
 *  3. Gate de admin/owner: las categorías son decisión del admin.
 *  4. Cap: máximo 30 categorías activas por place.
 *  5. Invariants del dominio (defensa en profundidad sobre Zod).
 *  6. Resuelve slug único combinando RESERVED + slugs existentes en
 *     este place.
 *  7. INSERT atómico.
 *  8. Revalida `/library` + `/settings/library`.
 *
 * No hay tx — la sola fila a insertar es atómica per-row. Si el slug
 * colisiona pese al resolver (race condition), Prisma lanza P2002 y
 * el caller ve `ConflictError` indirecto via Postgres.
 *
 * Ver `docs/features/library/spec.md` § 14.2.
 */
export async function createLibraryCategoryAction(
  input: unknown,
): Promise<{ ok: true; categoryId: string; slug: string }> {
  const parsed = createCategoryInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para crear categoría.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const actor = await resolveActorForPlace({ placeId: data.placeId })
  if (!actor.isAdmin) {
    throw new AuthorizationError('Solo admin/owner pueden crear categorías.', {
      placeId: actor.placeId,
      actorId: actor.actorId,
    })
  }

  validateCategoryTitle(data.title)
  validateCategoryEmoji(data.emoji)

  const trimmedTitle = data.title.trim()

  const currentCount = await prisma.libraryCategory.count({
    where: { placeId: actor.placeId, archivedAt: null },
  })
  assertCategoryCapacity(currentCount)

  const existingSlugs = await prisma.libraryCategory.findMany({
    where: { placeId: actor.placeId },
    select: { slug: true },
  })
  const reserved = new Set<string>([
    ...RESERVED_LIBRARY_CATEGORY_SLUGS,
    ...existingSlugs.map((c) => c.slug),
  ])
  const slug = generateLibraryCategorySlug(trimmedTitle, { reserved })
  validateCategorySlug(slug)

  const created = await prisma.libraryCategory.create({
    data: {
      placeId: actor.placeId,
      slug,
      emoji: data.emoji,
      title: trimmedTitle,
      contributionPolicy: data.contributionPolicy,
    },
    select: { id: true, slug: true },
  })

  logger.info(
    {
      event: 'libraryCategoryCreated',
      placeId: actor.placeId,
      categoryId: created.id,
      slug: created.slug,
      contributionPolicy: data.contributionPolicy,
      actorId: actor.actorId,
    },
    'library category created',
  )

  revalidateLibraryCategoryPaths(actor.placeSlug, created.slug)
  return { ok: true, categoryId: created.id, slug: created.slug }
}
