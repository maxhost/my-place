'use server'

import { z } from 'zod'
import { prisma } from '@/db/client'
import { NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import type { PostListView } from '@/features/discussions/domain/types'
import { resolveActorForPlace } from '../actor'
import { listCommentsByPost, listPostsByPlace, type CommentView } from '../queries'

/**
 * Cursor serializado para load-more. El callsite cliente recibe `nextCursor`
 * como string ISO + id y lo reenvía sin modificar; la action lo deserializa
 * a `Date` antes de pasarlo a las queries.
 */
export type SerializedCursor = { createdAt: string; id: string }

const cursorSchema = z
  .object({
    createdAt: z.string().datetime(),
    id: z.string().min(1),
  })
  .strict()

const loadMoreCommentsInputSchema = z.object({
  postId: z.string().min(1),
  cursor: cursorSchema.nullable().optional(),
})

const loadMorePostsInputSchema = z.object({
  placeId: z.string().min(1),
  cursor: cursorSchema.nullable().optional(),
})

/**
 * Extiende la lista de comments de un post. Resuelve `post.placeId` →
 * `resolveActorForPlace` para enforce membership activa; admin ve posts
 * ocultos y comments deleteados con body intacto.
 */
export async function loadMoreCommentsAction(input: unknown): Promise<{
  ok: true
  items: CommentView[]
  nextCursor: SerializedCursor | null
}> {
  const parsed = loadMoreCommentsInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  const data = parsed.data

  const post = await prisma.post.findUnique({
    where: { id: data.postId },
    select: { id: true, placeId: true, hiddenAt: true },
  })
  if (!post) {
    throw new NotFoundError('Post no encontrado.', { postId: data.postId })
  }

  const actor = await resolveActorForPlace({ placeId: post.placeId })
  if (post.hiddenAt && !actor.isAdmin) {
    throw new NotFoundError('Post no encontrado.', { postId: data.postId })
  }

  const cursor = data.cursor
    ? { createdAt: new Date(data.cursor.createdAt), id: data.cursor.id }
    : null

  const { items, nextCursor } = await listCommentsByPost({
    postId: post.id,
    cursor,
    includeDeleted: actor.isAdmin,
  })

  return {
    ok: true,
    items,
    nextCursor: nextCursor
      ? { createdAt: nextCursor.createdAt.toISOString(), id: nextCursor.id }
      : null,
  }
}

/**
 * Extiende la lista de posts del place. Admin ve posts ocultos; miembros no.
 */
export async function loadMorePostsAction(input: unknown): Promise<{
  ok: true
  items: PostListView[]
  nextCursor: SerializedCursor | null
}> {
  const parsed = loadMorePostsInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  const data = parsed.data

  const actor = await resolveActorForPlace({ placeId: data.placeId })

  const cursor = data.cursor
    ? { createdAt: new Date(data.cursor.createdAt), id: data.cursor.id }
    : null

  const { items, nextCursor } = await listPostsByPlace({
    placeId: actor.placeId,
    cursor,
    includeHidden: actor.isAdmin,
    viewerUserId: actor.actorId,
  })

  return {
    ok: true,
    items,
    nextCursor: nextCursor
      ? { createdAt: nextCursor.createdAt.toISOString(), id: nextCursor.id }
      : null,
  }
}
