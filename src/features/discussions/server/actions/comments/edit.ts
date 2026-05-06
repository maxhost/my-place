'use server'

import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { assertPlaceOpenOrThrow } from '@/features/hours/public.server'
import { logger } from '@/shared/lib/logger'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'
import {
  editCommentInputSchema,
  openCommentEditSessionInputSchema,
  type EditCommentInput,
} from '@/features/discussions/schemas'
import { assertCommentAlive, editWindowOpen } from '@/features/discussions/domain/invariants'
import { EditWindowExpired } from '@/features/discussions/domain/errors'
import {
  EDIT_SESSION_GRACE_MS,
  assertEditSessionToken,
  signEditSessionToken,
} from '@/shared/lib/edit-session-token'
import { resolveActorForPlace, type DiscussionActor } from '@/features/discussions/server/actor'
import { revalidateCommentPaths } from './shared'

type CommentForEdit = {
  id: string
  placeId: string
  postId: string
  authorUserId: string | null
  createdAt: Date
  deletedAt: Date | null
  post: { slug: string }
}

/**
 * Edita un Comment. Sólo autor en los primeros 60s (con session token: grace
 * de 5min). Admin NO edita comentarios (spec §7).
 */
export async function editCommentAction(input: unknown): Promise<{ ok: true; version: number }> {
  const data = parseEditInput(input)
  const comment = await fetchCommentForEdit(data.commentId)
  assertCommentAlive(comment)

  const actor = await resolveActorForPlace({ placeId: comment.placeId })
  await assertPlaceOpenOrThrow(actor.placeId)

  requireAuthorship(comment, actor)

  const now = new Date()
  if (data.session) {
    authorizeEditWithSession(comment, data.session, actor.actorId, now)
  } else {
    authorizeEditClassic(comment, now)
  }

  // stub F.1: validación de tamaño rich-text se reintroduce en F.2 con Lexical AST.
  const nextVersion = await applyEdit(comment, data, now)
  logCommentEdited(actor, comment)
  revalidateCommentPaths(actor.placeSlug, comment.post.slug)
  return { ok: true, version: nextVersion }
}

/**
 * Abre sesión de edición de Comment. Devuelve token HMAC firmado. Comments no
 * tienen admin-edit, así que siempre exige autoría y ventana abierta.
 */
export async function openCommentEditSession(input: unknown): Promise<{
  ok: true
  session: { token: string; openedAt: string; graceMs: number }
}> {
  const parsed = openCommentEditSessionInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  const data = parsed.data

  const comment = await prisma.comment.findUnique({
    where: { id: data.commentId },
    select: {
      id: true,
      placeId: true,
      authorUserId: true,
      createdAt: true,
      deletedAt: true,
    },
  })
  if (!comment) {
    throw new NotFoundError('Comentario no encontrado.', { commentId: data.commentId })
  }
  assertCommentAlive(comment)

  const actor = await resolveActorForPlace({ placeId: comment.placeId })
  if (!comment.authorUserId || comment.authorUserId !== actor.actorId) {
    throw new AuthorizationError('No podés editar este comentario.', {
      commentId: comment.id,
    })
  }

  const now = new Date()
  if (!editWindowOpen(comment.createdAt, now)) {
    throw new EditWindowExpired({
      entityId: comment.id,
      createdAt: comment.createdAt,
      now,
      elapsedMs: now.getTime() - comment.createdAt.getTime(),
    })
  }

  const openedAt = now.toISOString()
  const token = signEditSessionToken({
    subjectType: 'COMMENT',
    subjectId: comment.id,
    userId: actor.actorId,
    openedAt,
  })
  return { ok: true, session: { token, openedAt, graceMs: EDIT_SESSION_GRACE_MS } }
}

function parseEditInput(input: unknown): EditCommentInput {
  const parsed = editCommentInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para editar comentario.', {
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

async function fetchCommentForEdit(commentId: string): Promise<CommentForEdit> {
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

function requireAuthorship(comment: CommentForEdit, actor: DiscussionActor): void {
  if (!comment.authorUserId || actor.userId !== comment.authorUserId) {
    throw new AuthorizationError('No podés editar este comentario.', {
      commentId: comment.id,
    })
  }
}

function authorizeEditClassic(comment: CommentForEdit, now: Date): void {
  if (!editWindowOpen(comment.createdAt, now)) {
    throw new EditWindowExpired({
      entityId: comment.id,
      createdAt: comment.createdAt,
      now,
      elapsedMs: now.getTime() - comment.createdAt.getTime(),
    })
  }
}

function authorizeEditWithSession(
  comment: CommentForEdit,
  session: NonNullable<EditCommentInput['session']>,
  actorId: string,
  now: Date,
): void {
  assertEditSessionToken(
    session.token,
    {
      subjectType: 'COMMENT',
      subjectId: comment.id,
      userId: actorId,
      openedAt: session.openedAt,
    },
    now,
  )
  const openedAt = new Date(session.openedAt)
  if (!editWindowOpen(comment.createdAt, openedAt)) {
    throw new EditWindowExpired({
      entityId: comment.id,
      createdAt: comment.createdAt,
      now: openedAt,
      elapsedMs: openedAt.getTime() - comment.createdAt.getTime(),
    })
  }
}

async function applyEdit(
  comment: CommentForEdit,
  data: EditCommentInput,
  now: Date,
): Promise<number> {
  const nextVersion = data.expectedVersion + 1
  const updated = await prisma.comment.updateMany({
    where: { id: comment.id, version: data.expectedVersion, deletedAt: null },
    data: {
      body: data.body as Prisma.InputJsonValue,
      editedAt: now,
      version: nextVersion,
    },
  })
  if (updated.count === 0) {
    throw new ConflictError('El comentario cambió desde que lo abriste.', {
      commentId: comment.id,
      expectedVersion: data.expectedVersion,
    })
  }
  return nextVersion
}

function logCommentEdited(actor: DiscussionActor, comment: CommentForEdit): void {
  logger.info(
    {
      event: 'commentEdited',
      placeId: actor.placeId,
      postId: comment.postId,
      commentId: comment.id,
      actorId: actor.actorId,
    },
    'comment edited',
  )
}
