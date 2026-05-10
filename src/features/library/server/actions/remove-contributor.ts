'use server'

import { prisma } from '@/db/client'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { logger } from '@/shared/lib/logger'
import { resolveActorForPlace } from '@/features/discussions/public.server'
import { hasPermission } from '@/features/members/public.server'
import { removeContributorInputSchema } from '@/features/library/schemas'
import { revalidateLibraryCategoryPaths } from './shared'

/**
 * Quita a un contribuidor designado de una categoría.
 *
 * Solo admin/owner del place puede ejecutar. La operación es
 * idempotente: si la fila no existe (ya fue removida) retorna
 * `alreadyRemoved: true` sin error.
 */
export async function removeContributorAction(
  input: unknown,
): Promise<{ ok: true; alreadyRemoved: boolean }> {
  const parsed = removeContributorInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para quitar contribuidor.', {
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
  // G.3 port: scopable por categoría.
  const allowed = await hasPermission(actor.actorId, actor.placeId, 'library:moderate-categories', {
    categoryId: category.id,
  })
  if (!allowed) {
    throw new AuthorizationError('Solo admin/owner pueden quitar contribuidores.', {
      placeId: actor.placeId,
      categoryId: category.id,
      actorId: actor.actorId,
    })
  }

  const result = await prisma.libraryCategoryContributor.deleteMany({
    where: { categoryId: category.id, userId: data.userId },
  })

  const alreadyRemoved = result.count === 0

  logger.info(
    {
      event: alreadyRemoved ? 'libraryContributorRemoveSkipped' : 'libraryContributorRemoved',
      placeId: actor.placeId,
      categoryId: category.id,
      removedUserId: data.userId,
      actorId: actor.actorId,
    },
    alreadyRemoved ? 'contributor was not in list; idempotent skip' : 'library contributor removed',
  )

  revalidateLibraryCategoryPaths(actor.placeSlug, category.slug, actor.placeId)
  return { ok: true, alreadyRemoved }
}
