'use server'

import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'
import { logger } from '@/shared/lib/logger'
import { canEditItem, validateItemCoverUrl } from '@/features/library/public'
import { updateItemInputSchema } from '@/features/library/schemas'
import { resolveLibraryViewer, revalidateLibraryItemPaths } from '@/features/library/public.server'

/**
 * Actualiza el body + título + cover de un item.
 *
 * El slug del Post NO cambia (inmutable post-create — mismo precedente
 * que Post de discusiones). Si el author cambia el título, el slug
 * sigue apuntando al original.
 *
 * Permitido para admin/owner del place o el author del item. La
 * RLS de UPDATE de LibraryItem también enforce esto a nivel SQL.
 */
export async function updateLibraryItemAction(input: unknown): Promise<{
  ok: true
  itemId: string
  postSlug: string
  categorySlug: string
  version: number
}> {
  const parsed = updateItemInputSchema.safeParse(input)
  if (!parsed.success) {
    logger.warn(
      {
        event: 'libraryItemUpdateValidationFailed',
        issues: parsed.error.issues,
      },
      'updateLibraryItemAction zod validation failed',
    )
    throw new ValidationError('Datos inválidos para actualizar item.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const item = await prisma.libraryItem.findUnique({
    where: { id: data.itemId },
    select: {
      id: true,
      placeId: true,
      authorUserId: true,
      categoryId: true,
      category: { select: { slug: true } },
      post: { select: { id: true, slug: true } },
    },
  })
  if (!item) {
    throw new NotFoundError('Item no encontrado.', { itemId: data.itemId })
  }

  const { viewer, actor } = await resolveLibraryViewer({ placeId: item.placeId })
  // G.3 (decisión ADR #2): editar contenido ajeno NO es permiso atómico.
  // Author edita su item; admin/owner bypassea via `viewer.isAdmin`.
  if (!canEditItem({ authorUserId: item.authorUserId }, viewer)) {
    throw new AuthorizationError('No tenés permiso para editar este item.', {
      placeId: actor.placeId,
      itemId: item.id,
      actorId: actor.actorId,
    })
  }

  validateItemCoverUrl(data.coverUrl ?? null)
  // stub F.1: validación de tamaño rich-text se reintroduce en F.2 con Lexical AST.
  const trimmedTitle = data.title.trim()
  const now = new Date()
  const nextVersion = data.expectedVersion + 1

  // Optimistic locking sobre Post.version: si otro editor pisó el item
  // entre que el cliente lo abrió y guardó, `updateMany` matchea 0 filas
  // → ConflictError. Mismo patrón que `applyEdit` en discussions/posts.
  await prisma.$transaction(async (tx) => {
    const result = await tx.post.updateMany({
      where: { id: item.post.id, version: data.expectedVersion },
      data: {
        title: trimmedTitle,
        body: data.body as Prisma.InputJsonValue,
        editedAt: now,
        version: nextVersion,
      },
    })
    if (result.count === 0) {
      throw new ConflictError('El item cambió desde que lo abriste.', {
        itemId: item.id,
        expectedVersion: data.expectedVersion,
      })
    }
    await tx.libraryItem.update({
      where: { id: item.id },
      data: { coverUrl: data.coverUrl ?? null },
    })
  })

  logger.info(
    {
      event: 'libraryItemUpdated',
      placeId: actor.placeId,
      itemId: item.id,
      postId: item.post.id,
      actorId: actor.actorId,
    },
    'library item updated',
  )

  revalidateLibraryItemPaths(actor.placeSlug, item.category.slug, item.post.slug)
  return {
    ok: true,
    itemId: item.id,
    postSlug: item.post.slug,
    categorySlug: item.category.slug,
    version: nextVersion,
  }
}
