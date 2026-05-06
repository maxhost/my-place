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
  editPostInputSchema,
  openPostEditSessionInputSchema,
  type EditPostInput,
} from '@/features/discussions/schemas'
import { editWindowOpen } from '@/features/discussions/domain/invariants'
import { EditWindowExpired } from '@/features/discussions/domain/errors'
import {
  EDIT_SESSION_GRACE_MS,
  assertEditSessionToken,
  signEditSessionToken,
} from '@/shared/lib/edit-session-token'
import { findPlaceOwnership } from '@/shared/lib/identity-cache'
import { resolveActorForPlace, type DiscussionActor } from '@/features/discussions/server/actor'
import { revalidatePostPaths } from './shared'

type PostForEdit = {
  id: string
  placeId: string
  authorUserId: string | null
  slug: string
  createdAt: Date
  hiddenAt: Date | null
}

/**
 * Edita título/body de un Post. Autor dentro de 60s (con session token: grace
 * de 5min); admin siempre. Optimistic lock por `version` — si otro submit
 * ganó la carrera, 409.
 */
export async function editPostAction(input: unknown): Promise<{ ok: true; version: number }> {
  const data = parseEditInput(input)
  const post = await fetchPostForEdit(data.postId)

  const actor = await resolveActorForPlace({ placeId: post.placeId })
  await assertPlaceOpenOrThrow(actor.placeId)

  // G.3 (decisión ADR #2): editar contenido ajeno NO es permiso atómico
  // delegable. Sólo bypass para owner (vía PlaceOwnership). Admin sin
  // owner debe esperar al author 60s window. El branch fallback de
  // hasPermission se queda para `actor.isAdmin` legacy en logs/UI.
  const isOwner = await findPlaceOwnership(actor.actorId, actor.placeId)
  const now = new Date()
  if (!isOwner) {
    requireAuthorship(post, actor)
    if (data.session) {
      authorizeAuthorEditWithSession(post, data.session, actor.actorId, now)
    } else {
      authorizeAuthorEditClassic(post, now)
    }
  }

  // stub F.1: validación de tamaño rich-text se reintroduce en F.2 con Lexical AST.

  const nextVersion = await applyEdit(post, data, now)
  logPostEdited(actor, post, isOwner)
  revalidatePostPaths(actor.placeSlug, post.slug)
  return { ok: true, version: nextVersion }
}

/**
 * Abre una sesión de edición de Post. Autor actual (dentro de 60s) recibe un
 * token HMAC firmado; admin recibe `adminBypass: true` sin token. El cliente
 * guarda el token y lo envía en `editPostAction` — permite guardar dentro del
 * grace window (5min) aunque los 60s clásicos hayan vencido.
 *
 * Ver `docs/decisions/2026-04-21-edit-session-token.md`.
 */
export async function openPostEditSession(
  input: unknown,
): Promise<
  | { ok: true; session: { token: string; openedAt: string; graceMs: number } }
  | { ok: true; adminBypass: true }
> {
  const parsed = openPostEditSessionInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  const data = parsed.data

  const post = await prisma.post.findUnique({
    where: { id: data.postId },
    select: { id: true, placeId: true, authorUserId: true, createdAt: true },
  })
  if (!post) throw new NotFoundError('Post no encontrado.', { postId: data.postId })

  const actor = await resolveActorForPlace({ placeId: post.placeId })
  // G.3 (decisión ADR #2): only owner can bypass author window (no atomic
  // permission for `discussions:edit-post`).
  const isOwner = await findPlaceOwnership(actor.actorId, actor.placeId)
  if (isOwner) return { ok: true, adminBypass: true }
  if (!post.authorUserId || post.authorUserId !== actor.actorId) {
    throw new AuthorizationError('No podés editar este post.', { postId: post.id })
  }

  const now = new Date()
  if (!editWindowOpen(post.createdAt, now)) {
    throw new EditWindowExpired({
      entityId: post.id,
      createdAt: post.createdAt,
      now,
      elapsedMs: now.getTime() - post.createdAt.getTime(),
    })
  }

  const openedAt = now.toISOString()
  const token = signEditSessionToken({
    subjectType: 'POST',
    subjectId: post.id,
    userId: actor.actorId,
    openedAt,
  })
  return { ok: true, session: { token, openedAt, graceMs: EDIT_SESSION_GRACE_MS } }
}

function parseEditInput(input: unknown): EditPostInput {
  const parsed = editPostInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para editar post.', {
      issues: parsed.error.issues,
    })
  }
  return parsed.data
}

async function fetchPostForEdit(postId: string): Promise<PostForEdit> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      placeId: true,
      authorUserId: true,
      slug: true,
      createdAt: true,
      hiddenAt: true,
    },
  })
  if (!post) throw new NotFoundError('Post no encontrado.', { postId })
  return post
}

function requireAuthorship(post: PostForEdit, actor: DiscussionActor): void {
  if (!post.authorUserId || post.authorUserId !== actor.actorId) {
    throw new AuthorizationError('No podés editar este post.', { postId: post.id })
  }
}

/**
 * Fallback sin token: el submit pasa sólo si estamos dentro de los 60s desde
 * `createdAt`. Se mantiene para callers viejos y casos de fallback si el open
 * de session falla.
 */
function authorizeAuthorEditClassic(post: PostForEdit, now: Date): void {
  if (!editWindowOpen(post.createdAt, now)) {
    throw new EditWindowExpired({
      entityId: post.id,
      createdAt: post.createdAt,
      now,
      elapsedMs: now.getTime() - post.createdAt.getTime(),
    })
  }
}

/**
 * Con token: valida firma + grace (`assertEditSessionToken`) y además chequea
 * que al `openedAt` la ventana estaba abierta — impide que un token viejo de
 * otro post se reuse o que un cliente fabrique un openedAt arbitrario.
 */
function authorizeAuthorEditWithSession(
  post: PostForEdit,
  session: NonNullable<EditPostInput['session']>,
  actorId: string,
  now: Date,
): void {
  assertEditSessionToken(
    session.token,
    {
      subjectType: 'POST',
      subjectId: post.id,
      userId: actorId,
      openedAt: session.openedAt,
    },
    now,
  )
  const openedAt = new Date(session.openedAt)
  if (!editWindowOpen(post.createdAt, openedAt)) {
    throw new EditWindowExpired({
      entityId: post.id,
      createdAt: post.createdAt,
      now: openedAt,
      elapsedMs: openedAt.getTime() - post.createdAt.getTime(),
    })
  }
}

async function applyEdit(post: PostForEdit, data: EditPostInput, now: Date): Promise<number> {
  const nextVersion = data.expectedVersion + 1
  const updated = await prisma.post.updateMany({
    where: { id: post.id, version: data.expectedVersion },
    data: {
      title: data.title.trim(),
      body: data.body ? (data.body as Prisma.InputJsonValue) : Prisma.JsonNull,
      editedAt: now,
      version: nextVersion,
    },
  })
  if (updated.count === 0) {
    throw new ConflictError('El post cambió desde que lo abriste.', {
      postId: post.id,
      expectedVersion: data.expectedVersion,
    })
  }
  return nextVersion
}

function logPostEdited(actor: DiscussionActor, post: PostForEdit, isOwner: boolean): void {
  logger.info(
    {
      event: 'postEdited',
      placeId: actor.placeId,
      postId: post.id,
      actorId: actor.actorId,
      actorRole: isOwner ? 'owner' : 'author',
      byAdmin: isOwner && post.authorUserId !== actor.actorId,
    },
    'post edited',
  )
}
