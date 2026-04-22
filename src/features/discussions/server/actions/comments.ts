'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { assertPlaceOpenOrThrow } from '@/features/hours/public'
import { logger } from '@/shared/lib/logger'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'
import {
  createCommentInputSchema,
  deleteCommentInputSchema,
  editCommentInputSchema,
  openCommentEditSessionInputSchema,
} from '@/features/discussions/schemas'
import {
  assertCommentAlive,
  assertPostOpenForActivity,
  assertQuotedCommentAlive,
  assertQuotedCommentBelongsToPost,
  buildAuthorSnapshot,
  buildQuoteSnapshot,
  canDeleteContent,
  editWindowOpen,
} from '@/features/discussions/domain/invariants'
import { EditWindowExpired } from '@/features/discussions/domain/errors'
import {
  EDIT_SESSION_GRACE_MS,
  assertEditSessionToken,
  signEditSessionToken,
} from '@/shared/lib/edit-session-token'
import { assertRichTextSize } from '@/features/discussions/domain/rich-text'
import type { QuoteSnapshot } from '@/features/discussions/domain/types'
import { resolveActorForPlace } from '../actor'
import { findQuoteSource } from '../queries'

/**
 * Crea un Comment en un Post. Transacción atómica:
 *  1. Inserta el comment con `quotedSnapshot` congelado (si citó).
 *  2. Actualiza `Post.lastActivityAt` — reactiva posts dormidos y re-ordena la lista.
 *
 * Quote validation:
 *  - `quotedCommentId` debe pertenecer al mismo `postId` (red de seguridad en DB,
 *    pero `assertQuotedCommentBelongsToPost` da error tipado temprano).
 *  - Target deletado ⇒ `InvalidQuoteTarget('not_found')`. Citas existentes persisten.
 *  - Auto-cita ⇒ `InvalidQuoteTarget('self')`. No aplica acá porque el comment
 *    nuevo aún no existe; se cubre al crear otro comment que apunte a sí mismo.
 */
export async function createCommentAction(
  input: unknown,
): Promise<{ ok: true; commentId: string }> {
  const parsed = createCommentInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para crear comentario.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const post = await prisma.post.findUnique({
    where: { id: data.postId },
    select: {
      id: true,
      placeId: true,
      slug: true,
      hiddenAt: true,
    },
  })
  if (!post) throw new NotFoundError('Post no encontrado.', { postId: data.postId })
  assertPostOpenForActivity(post)

  const actor = await resolveActorForPlace({ placeId: post.placeId })
  await assertPlaceOpenOrThrow(actor.placeId)
  assertRichTextSize(data.body)

  let quotedSnapshot: QuoteSnapshot | null = null
  if (data.quotedCommentId) {
    const source = await findQuoteSource(data.quotedCommentId)
    if (!source) {
      throw new NotFoundError('No pudimos encontrar el comentario citado.', {
        quotedCommentId: data.quotedCommentId,
      })
    }
    assertQuotedCommentBelongsToPost(source, post.id)
    assertQuotedCommentAlive(source)
    quotedSnapshot = buildQuoteSnapshot(source, null)
  }

  const now = new Date()
  const commentId = await prisma.$transaction(async (tx) => {
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

  logger.info(
    {
      event: 'commentCreated',
      placeId: actor.placeId,
      postId: post.id,
      commentId,
      actorId: actor.actorId,
      quoted: !!data.quotedCommentId,
    },
    'comment created',
  )

  revalidatePath(`/${actor.placeSlug}`)
  revalidatePath(`/${actor.placeSlug}/conversations`)
  revalidatePath(`/${actor.placeSlug}/conversations/${post.slug}`)
  return { ok: true, commentId }
}

/**
 * Edita un Comment: sólo autor en los primeros 60s. Admin no edita comentarios
 * (spec § 7 — tras 60s solo admin *delete*, nadie edita).
 */
export async function editCommentAction(input: unknown): Promise<{ ok: true; version: number }> {
  const parsed = editCommentInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para editar comentario.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const comment = await prisma.comment.findUnique({
    where: { id: data.commentId },
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
    throw new NotFoundError('Comentario no encontrado.', { commentId: data.commentId })
  }
  assertCommentAlive(comment)

  const actor = await resolveActorForPlace({ placeId: comment.placeId })
  await assertPlaceOpenOrThrow(actor.placeId)

  const now = new Date()
  if (!comment.authorUserId || actor.userId !== comment.authorUserId) {
    throw new AuthorizationError('No podés editar este comentario.', {
      commentId: comment.id,
    })
  }

  // Comments no tienen admin-edit (spec §7), así que siempre corre la lógica
  // de autor-en-ventana + token. Mismo patrón que posts: con token firmado al
  // abrir, el autor puede guardar aunque pasaron los 60s, dentro del grace.
  if (!data.session) {
    if (!editWindowOpen(comment.createdAt, now)) {
      throw new EditWindowExpired({
        entityId: comment.id,
        createdAt: comment.createdAt,
        now,
        elapsedMs: now.getTime() - comment.createdAt.getTime(),
      })
    }
  } else {
    assertEditSessionToken(
      data.session.token,
      {
        subjectType: 'COMMENT',
        subjectId: comment.id,
        userId: actor.actorId,
        openedAt: data.session.openedAt,
      },
      now,
    )
    const openedAt = new Date(data.session.openedAt)
    if (!editWindowOpen(comment.createdAt, openedAt)) {
      throw new EditWindowExpired({
        entityId: comment.id,
        createdAt: comment.createdAt,
        now: openedAt,
        elapsedMs: openedAt.getTime() - comment.createdAt.getTime(),
      })
    }
  }

  assertRichTextSize(data.body)

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

  revalidatePath(`/${actor.placeSlug}`)
  revalidatePath(`/${actor.placeSlug}/conversations`)
  revalidatePath(`/${actor.placeSlug}/conversations/${comment.post.slug}`)
  return { ok: true, version: nextVersion }
}

/**
 * Abre sesión de edición de Comment — igual patrón que `openPostEditSession`.
 * Comments no tienen admin-edit (spec §7), así que siempre responde con
 * session o rebota por window/autorización.
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
    throw new NotFoundError('Comentario no encontrado.', {
      commentId: data.commentId,
    })
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
  return {
    ok: true,
    session: { token, openedAt, graceMs: EDIT_SESSION_GRACE_MS },
  }
}

/**
 * Borra un Comment (soft). Autor puede en los primeros 60s; admin siempre.
 * El body se preserva en DB — admins lo pueden ver para auditoría. La UI de
 * miembros renderiza `[mensaje eliminado]`.
 */
export async function deleteCommentAction(input: unknown): Promise<{ ok: true; version: number }> {
  const parsed = deleteCommentInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  const data = parsed.data

  const comment = await prisma.comment.findUnique({
    where: { id: data.commentId },
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
    throw new NotFoundError('Comentario no encontrado.', { commentId: data.commentId })
  }
  assertCommentAlive(comment)

  const actor = await resolveActorForPlace({ placeId: comment.placeId })
  const now = new Date()
  if (!canDeleteContent(actor, comment.authorUserId, comment.createdAt, now)) {
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

  const nextVersion = data.expectedVersion + 1
  const updated = await prisma.comment.updateMany({
    where: { id: comment.id, version: data.expectedVersion, deletedAt: null },
    data: { deletedAt: now, version: nextVersion },
  })
  if (updated.count === 0) {
    throw new ConflictError('El comentario cambió desde que lo abriste.', {
      commentId: comment.id,
      expectedVersion: data.expectedVersion,
    })
  }

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

  revalidatePath(`/${actor.placeSlug}`)
  revalidatePath(`/${actor.placeSlug}/conversations`)
  revalidatePath(`/${actor.placeSlug}/conversations/${comment.post.slug}`)
  return { ok: true, version: nextVersion }
}
