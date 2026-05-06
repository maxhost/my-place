'use server'

import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { assertPlaceOpenOrThrow } from '@/features/hours/public.server'
import { logger } from '@/shared/lib/logger'
import { NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { createCommentInputSchema, type CreateCommentInput } from '@/features/discussions/schemas'
import {
  assertPostOpenForActivity,
  assertQuotedCommentAlive,
  assertQuotedCommentBelongsToPost,
  buildAuthorSnapshot,
} from '@/features/discussions/domain/invariants'
import type { QuoteSnapshot } from '@/features/discussions/domain/types'
import { resolveActorForPlace, type DiscussionActor } from '@/features/discussions/server/actor'
import {
  findCommentById,
  findQuoteSource,
} from '@/features/discussions/comments/server/queries/comments'
import { broadcastNewComment } from '@/features/discussions/server/realtime'
import { revalidateCommentPaths } from './shared'

type PostForCreate = {
  id: string
  placeId: string
  slug: string
  hiddenAt: Date | null
}

/**
 * Crea un Comment en un Post. Transacción atómica:
 *  1. Inserta el comment con `quotedSnapshot` congelado (si citó).
 *  2. Actualiza `Post.lastActivityAt` — reactiva posts dormidos y re-ordena la lista.
 *
 * Quote validation: target debe pertenecer al mismo postId, no estar deletado,
 * y profundidad ≤ 1 (ambos assertions están en `domain/invariants`).
 */
export async function createCommentAction(
  input: unknown,
): Promise<{ ok: true; commentId: string }> {
  const data = parseCreateInput(input)
  const post = await fetchPostForComment(data.postId)
  assertPostOpenForActivity(post)

  const actor = await resolveActorForPlace({ placeId: post.placeId })
  await assertPlaceOpenOrThrow(actor.placeId)
  // stub F.1: validación de tamaño rich-text se reintroduce en F.2 con Lexical AST.

  const quotedSnapshot = await resolveQuoteSnapshot(data, post.id)
  const now = new Date()
  const commentId = await insertCommentTx(post, actor, data, quotedSnapshot, now)
  logCommentCreated(actor, post, commentId, !!data.quotedCommentId)

  await emitCommentBroadcast(post.id, commentId)
  revalidateCommentPaths(actor.placeSlug, post.slug, 'create')
  return { ok: true, commentId }
}

/**
 * Re-fetchea el comment vía `findCommentById` (post-commit) para obtener la
 * `CommentView` con el mapping consistente (body rehidratado, quotedSnapshot
 * congelado). Luego dispara el broadcast — best-effort, no throw.
 */
async function emitCommentBroadcast(postId: string, commentId: string): Promise<void> {
  const view = await findCommentById(commentId)
  if (!view) return
  await broadcastNewComment(postId, { comment: view })
}

function parseCreateInput(input: unknown): CreateCommentInput {
  const parsed = createCommentInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para crear comentario.', {
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

async function fetchPostForComment(postId: string): Promise<PostForCreate> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, placeId: true, slug: true, hiddenAt: true },
  })
  if (!post) throw new NotFoundError('Post no encontrado.', { postId })
  return post
}

async function resolveQuoteSnapshot(
  data: CreateCommentInput,
  postId: string,
): Promise<QuoteSnapshot | null> {
  if (!data.quotedCommentId) return null
  const source = await findQuoteSource(data.quotedCommentId)
  if (!source) {
    throw new NotFoundError('No pudimos encontrar el comentario citado.', {
      quotedCommentId: data.quotedCommentId,
    })
  }
  assertQuotedCommentBelongsToPost(source, postId)
  assertQuotedCommentAlive(source)
  // stub F.1: quoteSnapshot se re-construye en F.2 sobre Lexical AST
  return null
}

async function insertCommentTx(
  post: PostForCreate,
  actor: DiscussionActor,
  data: CreateCommentInput,
  quotedSnapshot: QuoteSnapshot | null,
  now: Date,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: {
        postId: post.id,
        placeId: post.placeId,
        authorUserId: actor.actorId,
        authorSnapshot: buildAuthorSnapshot(actor.user) as Prisma.InputJsonValue,
        body: data.body as Prisma.InputJsonValue,
        quotedCommentId: data.quotedCommentId ?? null,
        quotedSnapshot: quotedSnapshot
          ? (quotedSnapshot as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
      select: { id: true },
    })
    await tx.post.updateMany({
      where: { id: post.id },
      data: { lastActivityAt: now },
    })
    return created.id
  })
}

function logCommentCreated(
  actor: DiscussionActor,
  post: PostForCreate,
  commentId: string,
  quoted: boolean,
): void {
  logger.info(
    {
      event: 'commentCreated',
      placeId: actor.placeId,
      postId: post.id,
      commentId,
      actorId: actor.actorId,
      quoted,
    },
    'comment created',
  )
}
