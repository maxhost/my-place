'use server'

import { prisma } from '@/db/client'
import { AuthorizationError, ConflictError, ValidationError } from '@/shared/errors/domain-error'
import { logger } from '@/shared/lib/logger'
import { resolveActorForPlace } from '@/features/discussions/public.server'
import { hasPermission } from '@/features/members/public.server'
import { reorderCategoriesInputSchema } from '@/features/library/schemas'
import { revalidateLibraryCategoryPaths } from './shared'

/**
 * Reordena las categorías de un place según el array provisto.
 *
 * El index del array es la posición visual final (0-based). La action
 * actualiza `position` en una transacción para que ningún viewer vea
 * estado inconsistente (medio reordenado).
 *
 * Validaciones:
 *  - Todos los `categoryIds` deben pertenecer al `placeId` del actor.
 *  - El set debe matchear EXACTO el conjunto de categorías no
 *    archivadas del place (sin omisiones, sin extras). Si admin agregó
 *    una categoría mientras el cliente tenía un drag abierto, el
 *    submit falla con `ConflictError` y la UI debe re-fetchear.
 *
 * No reordena archivadas — vivirían fuera del listado visible.
 */
export async function reorderLibraryCategoriesAction(
  input: unknown,
): Promise<{ ok: true; updated: number }> {
  const parsed = reorderCategoriesInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para reordenar categorías.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const actor = await resolveActorForPlace({ placeId: data.placeId })
  // G.3 port: reorder es global (sin categoryId scope).
  const allowed = await hasPermission(actor.actorId, actor.placeId, 'library:moderate-categories')
  if (!allowed) {
    throw new AuthorizationError('Solo admin/owner pueden reordenar categorías.', {
      placeId: actor.placeId,
      actorId: actor.actorId,
    })
  }

  const live = await prisma.libraryCategory.findMany({
    where: { placeId: actor.placeId, archivedAt: null },
    select: { id: true },
  })
  const liveIds = new Set(live.map((c) => c.id))
  const inputSet = new Set(data.orderedCategoryIds)

  if (liveIds.size !== inputSet.size || ![...liveIds].every((id) => inputSet.has(id))) {
    throw new ConflictError('La lista de categorías cambió mientras reordenabas.', {
      placeId: actor.placeId,
      liveCount: liveIds.size,
      inputCount: inputSet.size,
    })
  }

  const updated = await prisma.$transaction(
    data.orderedCategoryIds.map((id, index) =>
      prisma.libraryCategory.update({
        where: { id },
        data: { position: index },
      }),
    ),
  )

  logger.info(
    {
      event: 'libraryCategoriesReordered',
      placeId: actor.placeId,
      count: updated.length,
      actorId: actor.actorId,
    },
    'library categories reordered',
  )

  revalidateLibraryCategoryPaths(actor.placeSlug, undefined, actor.placeId)
  return { ok: true, updated: updated.length }
}
