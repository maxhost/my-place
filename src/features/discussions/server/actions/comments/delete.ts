'use server'

import { prisma } from '@/db/client'
import { logger } from '@/shared/lib/logger'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'
import { deleteCommentInputSchema } from '@/features/discussions/schemas'
import {
  assertCommentAlive,
  canDeleteContent,
  editWindowOpen,
} from '@/features/discussions/domain/invariants'
import { EditWindowExpired } from '@/features/discussions/domain/errors'
import { resolveActorForPlace, type DiscussionActor } from '@/features/discussions/server/actor'
import { hasPermission } from '@/features/members/public.server'
import { revalidateCommentPaths } from './shared'

type CommentForDelete = {
  id: string
  placeId: string
  postId: string
  authorUserId: string | null
  createdAt: Date
  deletedAt: Date | null
  post: { slug: string }
}

/**
 * Borra un Comment (soft). Autor dentro de 60s; admin siempre. El body se
 * preserva — la UI de miembros renderiza `[mensaje eliminado]`; admin lo ve
 * raw para auditoría.
 */
export async function deleteCommentAction(input: unknown): Promise<{ ok: true; version: number }> {
  const parsed = deleteCommentInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  const data = parsed.data

  const comment = await fetchCommentForDelete(data.commentId)
  assertCommentAlive(comment)

  const actor = await resolveActorForPlace({ placeId: comment.placeId })
  const now = new Date()

  // G.3 port (2026-05-09): owner + grupos con `discussions:delete-comment`
  // pueden borrar comments ajenos. Override de `actor.isAdmin` para que
  // `canDeleteContent` lo respete sin tocar el dominio. Ver
  // `docs/plans/2026-05-09-g3-debt-port-to-legacy.md` § A5.
  const canModerate = await hasPermission(
    actor.actorId,
    actor.placeId,
    'discussions:delete-comment',
  )
  const effectiveActor = { ...actor, isAdmin: canModerate || actor.isAdmin }
  authorizeCommentDelete(effectiveActor, comment, now)

  const nextVersion = await applySoftDelete(comment, data.expectedVersion, now)
  logCommentDeleted(effectiveActor, comment)
  revalidateCommentPaths(actor.placeSlug, comment.post.slug)
  return { ok: true, version: nextVersion }
}

async function fetchCommentForDelete(commentId: string): Promise<CommentForDelete> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      placeId: true,
      postId: true,
      authorUserId: true,
      createdAt: true,
      deletedAt: true,
      post: { select: { slug: true } },
    },
  })
  if (!comment) {
    throw new NotFoundError('Comentario no encontrado.', { commentId })
  }
  return comment
}

function authorizeCommentDelete(
  actor: DiscussionActor,
  comment: CommentForDelete,
  now: Date,
): void {
  if (canDeleteContent(actor, comment.authorUserId, comment.createdAt, now)) return

  // Error más específico si el problema es la ventana del autor, no la autoría.
  if (
    !actor.isAdmin &&
    comment.authorUserId === actor.actorId &&
    !editWindowOpen(comment.createdAt, now)
  ) {
    throw new EditWindowExpired({
      entityId: comment.id,
      createdAt: comment.createdAt,
      now,
      elapsedMs: now.getTime() - comment.createdAt.getTime(),
    })
  }
  throw new AuthorizationError('No podés borrar este comentario.', {
    commentId: comment.id,
  })
}

async function applySoftDelete(
  comment: CommentForDelete,
  expectedVersion: number,
  now: Date,
): Promise<number> {
  const nextVersion = expectedVersion + 1
  const updated = await prisma.comment.updateMany({
    where: { id: comment.id, version: expectedVersion, deletedAt: null },
    data: { deletedAt: now, version: nextVersion },
  })
  if (updated.count === 0) {
    throw new ConflictError('El comentario cambió desde que lo abriste.', {
      commentId: comment.id,
      expectedVersion,
    })
  }
  return nextVersion
}

function logCommentDeleted(actor: DiscussionActor, comment: CommentForDelete): void {
  logger.info(
    {
      event: 'commentDeleted',
      placeId: actor.placeId,
      postId: comment.postId,
      commentId: comment.id,
      actorId: actor.actorId,
      byAdmin: actor.isAdmin && comment.authorUserId !== actor.actorId,
    },
    'comment deleted',
  )
}
