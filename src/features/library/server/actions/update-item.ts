'use server'

import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { logger } from '@/shared/lib/logger'
import { resolveActorForPlace } from '@/features/discussions/public.server'
import { assertRichTextSize } from '@/features/discussions/public'
import { canEditItem, validateItemCoverUrl } from '@/features/library/public'
import { updateItemInputSchema } from '@/features/library/schemas'
import { revalidateLibraryItemPaths, safeStringify } from './shared'

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
export async function updateLibraryItemAction(
  input: unknown,
): Promise<{ ok: true; itemId: string; postSlug: string; categorySlug: string }> {
  const parsed = updateItemInputSchema.safeParse(input)
  if (!parsed.success) {
    logger.warn(
      {
        event: 'libraryItemUpdateValidationFailed',
        issues: parsed.error.issues,
        bodyRaw: safeStringify((input as { body?: unknown })?.body, 4000),
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

  const actor = await resolveActorForPlace({ placeId: item.placeId })
  if (
    !canEditItem(
      { authorUserId: item.authorUserId },
      { userId: actor.actorId, isAdmin: actor.isAdmin },
    )
  ) {
    throw new AuthorizationError('No tenés permiso para editar este item.', {
      placeId: actor.placeId,
      itemId: item.id,
      actorId: actor.actorId,
    })
  }

  validateItemCoverUrl(data.coverUrl ?? null)
  assertRichTextSize(data.body)
  const trimmedTitle = data.title.trim()
  const now = new Date()

  await prisma.$transaction(async (tx) => {
    await tx.post.update({
      where: { id: item.post.id },
      data: {
        title: trimmedTitle,
        body: data.body as Prisma.InputJsonValue,
        editedAt: now,
        version: { increment: 1 },
      },
    })
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
  }
}
