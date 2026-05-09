'use server'

import { prisma } from '@/db/client'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { logger } from '@/shared/lib/logger'
import { resolveActorForPlace } from '@/features/discussions/public.server'
import {
  validateCategoryEmoji,
  validateCategoryTitle,
  validateContributionPolicy,
} from '@/features/library/domain/invariants'
import { updateCategoryInputSchema } from '@/features/library/schemas'
import { revalidateLibraryCategoryPaths } from './shared'

/**
 * Actualiza emoji + título + contributionPolicy de una categoría.
 *
 * El slug NO se actualiza — es inmutable post-create (mismo principio
 * que Place.slug y Post.slug). Si el admin quiere "renombrar" en
 * términos de URL, archiva y recrea.
 *
 * Si el cambio de policy reduce el set permitido (ej.
 * MEMBERS_OPEN → ADMIN_ONLY), los items ya existentes NO se afectan
 * — siguen vivos. La policy solo gobierna NEW INSERTS, no items
 * históricos.
 *
 * Ver `docs/features/library/spec.md` § 14.2.
 */
export async function updateLibraryCategoryAction(
  input: unknown,
): Promise<{ ok: true; categoryId: string; slug: string }> {
  const parsed = updateCategoryInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para actualizar categoría.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const category = await prisma.libraryCategory.findUnique({
    where: { id: data.categoryId },
    select: { id: true, placeId: true, slug: true },
  })
  if (!category) {
    throw new NotFoundError('Categoría no encontrada.', { categoryId: data.categoryId })
  }

  const actor = await resolveActorForPlace({ placeId: category.placeId })
  if (!actor.isAdmin) {
    throw new AuthorizationError('Solo admin/owner pueden editar categorías.', {
      placeId: actor.placeId,
      actorId: actor.actorId,
    })
  }

  validateCategoryTitle(data.title)
  validateCategoryEmoji(data.emoji)
  validateContributionPolicy(data.contributionPolicy)

  await prisma.libraryCategory.update({
    where: { id: category.id },
    data: {
      title: data.title.trim(),
      emoji: data.emoji,
      contributionPolicy: data.contributionPolicy,
    },
  })

  logger.info(
    {
      event: 'libraryCategoryUpdated',
      placeId: actor.placeId,
      categoryId: category.id,
      contributionPolicy: data.contributionPolicy,
      actorId: actor.actorId,
    },
    'library category updated',
  )

  revalidateLibraryCategoryPaths(actor.placeSlug, category.slug, actor.placeId)
  return { ok: true, categoryId: category.id, slug: category.slug }
}
