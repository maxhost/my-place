'use server'

import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { logger } from '@/shared/lib/logger'
import { assertPlaceOpenOrThrow } from '@/features/hours/public.server'
import { buildAuthorSnapshot } from '@/features/discussions/public'
import {
  createPostFromSystemHelper,
  resolveActorForPlace,
} from '@/features/discussions/public.server'
import { canCreateInCategory, validateItemCoverUrl } from '@/features/library/public'
import { createItemInputSchema } from '@/features/library/schemas'
import { listCategoryContributorUserIds } from '../queries'
import { revalidateLibraryItemPaths, safeStringify } from './shared'

/**
 * Crea un item de biblioteca: thread documento (Post) + LibraryItem
 * en una **transacción atómica**.
 *
 * Flow:
 *  1. Parse Zod del input.
 *  2. Resuelve el actor + verifica que sea miembro activo.
 *  3. Resuelve la categoría (debe existir, no estar archivada,
 *     pertenecer al place del actor).
 *  4. Permission gate vía `canCreateInCategory`. Para policy
 *     `DESIGNATED` carga la lista de contributors.
 *  5. Gate `assertPlaceOpenOrThrow` — defensa en profundidad.
 *  6. Valida invariants del dominio (cover URL).
 *  7. Tx: `createPostFromSystemHelper` → INSERT LibraryItem con
 *     postId. Si una falla, rollback de ambas.
 *  8. Revalida paths del item.
 *
 * Ver `docs/features/library/spec.md` § 14.6.
 */
export async function createLibraryItemAction(
  input: unknown,
): Promise<{ ok: true; itemId: string; postSlug: string; categorySlug: string }> {
  const parsed = createItemInputSchema.safeParse(input)
  if (!parsed.success) {
    logger.warn(
      {
        event: 'libraryItemCreateValidationFailed',
        issues: parsed.error.issues,
        // Body raw (truncado a 4KB) para ver el shape exacto que falló.
        bodyRaw: safeStringify((input as { body?: unknown })?.body, 4000),
      },
      'createLibraryItemAction zod validation failed',
    )
    throw new ValidationError('Datos inválidos para crear item de biblioteca.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const actor = await resolveActorForPlace({ placeId: data.placeId })

  const category = await prisma.libraryCategory.findUnique({
    where: { id: data.categoryId },
    select: {
      id: true,
      slug: true,
      placeId: true,
      contributionPolicy: true,
      archivedAt: true,
    },
  })
  if (!category) {
    throw new NotFoundError('Categoría no encontrada.', { categoryId: data.categoryId })
  }
  if (category.placeId !== actor.placeId) {
    throw new NotFoundError('Categoría no pertenece al place del actor.', {
      categoryId: category.id,
    })
  }
  if (category.archivedAt) {
    throw new NotFoundError('La categoría está archivada.', { categoryId: category.id })
  }

  // Permission gate.
  const designatedUserIds =
    category.contributionPolicy === 'DESIGNATED'
      ? await listCategoryContributorUserIds(category.id)
      : []
  if (
    !canCreateInCategory(
      {
        contributionPolicy: category.contributionPolicy,
        designatedUserIds,
      },
      { userId: actor.actorId, isAdmin: actor.isAdmin },
    )
  ) {
    throw new AuthorizationError('No tenés permiso para agregar contenido en esta categoría.', {
      placeId: actor.placeId,
      categoryId: category.id,
      actorId: actor.actorId,
    })
  }

  await assertPlaceOpenOrThrow(actor.placeId)
  validateItemCoverUrl(data.coverUrl ?? null)

  const trimmedTitle = data.title.trim()
  const authorSnapshot = buildAuthorSnapshot(actor.user)

  const result = await prisma.$transaction(async (tx) => {
    const post = await createPostFromSystemHelper(tx, {
      placeId: actor.placeId,
      title: trimmedTitle,
      body: data.body as Prisma.InputJsonValue,
      authorUserId: actor.actorId,
      authorSnapshot: authorSnapshot as Prisma.InputJsonValue,
      originSystem: 'library_item',
      // El item todavía no tiene id — usamos postId como audit
      // placeholder; la fila final asocia ambos.
      originId: 'pending',
    })

    const item = await tx.libraryItem.create({
      data: {
        placeId: actor.placeId,
        categoryId: category.id,
        postId: post.id,
        authorUserId: actor.actorId,
        coverUrl: data.coverUrl ?? null,
      },
      select: { id: true },
    })

    return { itemId: item.id, postId: post.id, postSlug: post.slug }
  })

  logger.info(
    {
      event: 'libraryItemCreated',
      placeId: actor.placeId,
      itemId: result.itemId,
      postId: result.postId,
      postSlug: result.postSlug,
      categoryId: category.id,
      actorId: actor.actorId,
    },
    'library item created with thread',
  )

  revalidateLibraryItemPaths(actor.placeSlug, category.slug, result.postSlug)
  return {
    ok: true,
    itemId: result.itemId,
    postSlug: result.postSlug,
    categorySlug: category.slug,
  }
}
