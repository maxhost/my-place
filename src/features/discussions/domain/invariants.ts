/**
 * Invariantes del slice `discussions`. Funciones puras — sin Prisma, Next, React.
 *
 * Reglas de negocio (ventana 60s, vivo/dormido, quote consistency) se expresan
 * como `assert*` que lanzan errores estructurados, o `is*` / `can*` como
 * predicados para UI. El manejo del AST vive en `rich-text.ts`.
 *
 * Ver `docs/features/discussions/spec.md` § 8 (invariantes).
 */

import type { AuthorSnapshot, Post, QuoteSourceComment } from './types'
import {
  CommentDeletedError,
  EditWindowExpired,
  InvalidQuoteTarget,
  PostHiddenError,
} from './errors'

// ---------------------------------------------------------------
// Constantes del dominio
// ---------------------------------------------------------------

/** Ventana de edición autor (60 segundos tras `createdAt`). Spec § 8. */
export const EDIT_WINDOW_MS = 60_000

/** Umbral de "dormido": Post sin `lastActivityAt` en 30 días. Spec § 8. */
export const DORMANT_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000

/** Título del Post. Spec § 4. */
export const POST_TITLE_MIN_LENGTH = 1
export const POST_TITLE_MAX_LENGTH = 160

/** Excerpt de cita en `quotedSnapshot.bodyExcerpt`. Spec § 11. */
export const QUOTE_EXCERPT_MAX_CHARS = 200

/** Lista de emojis permitidos en reacciones (orden UI). Spec § 2. */
export const REACTION_EMOJI_DISPLAY = [
  'THUMBS_UP',
  'HEART',
  'LAUGH',
  'PRAY',
  'THINKING',
  'CRY',
] as const

/** Dwell mínimo para registrar `PostRead`. Spec § 9. */
export const DWELL_THRESHOLD_MS = 5_000

// ---------------------------------------------------------------
// Ventana de edición (60s)
// ---------------------------------------------------------------

export function editWindowOpen(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() < EDIT_WINDOW_MS
}

export function assertEditWindowOpen(createdAt: Date, now: Date, entityId: string): void {
  const elapsedMs = now.getTime() - createdAt.getTime()
  if (elapsedMs >= EDIT_WINDOW_MS) {
    throw new EditWindowExpired({ entityId, createdAt, now, elapsedMs })
  }
}

// ---------------------------------------------------------------
// Permisos derivados (para UI y guard auxiliar de actions)
// ---------------------------------------------------------------

export type ActorContext = {
  userId: string
  isAdmin: boolean
}

/**
 * Autor puede editar su propio contenido durante los primeros 60s.
 * Tras expirar: nadie edita (ni admin). Admin sólo hide/delete del Post.
 */
export function canEditAuthorContent(
  actor: ActorContext,
  authorUserId: string | null,
  createdAt: Date,
  now: Date,
): boolean {
  if (authorUserId === null) return false
  if (actor.userId !== authorUserId) return false
  return editWindowOpen(createdAt, now)
}

/**
 * Post edit: autor dentro de 60s o admin en cualquier momento. El admin
 * bypassea la ventana con intent moderación (fix de typos obvios, aclarar un
 * título confuso). Los edits de admin quedan marcados con `editedAt` igual
 * que los de autor; el audit vive en pino (`postEdited` + `byAdmin`).
 */
export function canEditPost(
  actor: ActorContext,
  authorUserId: string | null,
  createdAt: Date,
  now: Date,
): boolean {
  if (actor.isAdmin) return true
  return canEditAuthorContent(actor, authorUserId, createdAt, now)
}

/**
 * Autor puede borrar su propio contenido durante los primeros 60s.
 * Admin puede borrar contenido ajeno en cualquier momento (siempre soft delete).
 */
export function canDeleteContent(
  actor: ActorContext,
  authorUserId: string | null,
  createdAt: Date,
  now: Date,
): boolean {
  if (actor.isAdmin) return true
  if (authorUserId === null) return false
  if (actor.userId !== authorUserId) return false
  return editWindowOpen(createdAt, now)
}

/** Solo admin puede hide/unhide (sólo aplica a Post). */
export function canAdminHide(actor: ActorContext): boolean {
  return actor.isAdmin
}

// ---------------------------------------------------------------
// Estado derivado del Post + dormant
// ---------------------------------------------------------------

export function derivePostState(post: Pick<Post, 'hiddenAt'>): 'VISIBLE' | 'HIDDEN' {
  if (post.hiddenAt) return 'HIDDEN'
  return 'VISIBLE'
}

/** Un Post sin actividad ≥ 30 días pasa a "dormido" en render. No es columna. */
export function isDormant(lastActivityAt: Date, now: Date): boolean {
  return now.getTime() - lastActivityAt.getTime() > DORMANT_THRESHOLD_MS
}

/**
 * Guarda para acciones de escritura sobre Post: bloquea comentar / reaccionar
 * cuando el post está oculto. Admin maneja el estado aparte y bypassea.
 * Posts eliminados no llegan a este assert porque el row ya no existe (hard delete).
 */
export function assertPostOpenForActivity(post: Pick<Post, 'id' | 'hiddenAt'>): void {
  if (post.hiddenAt) {
    throw new PostHiddenError({ postId: post.id, hiddenAt: post.hiddenAt })
  }
}

export function assertCommentAlive(comment: { id: string; deletedAt: Date | null }): void {
  if (comment.deletedAt) {
    throw new CommentDeletedError({
      commentId: comment.id,
      deletedAt: comment.deletedAt,
    })
  }
}

// ---------------------------------------------------------------
// Snapshots (autor + cita)
// ---------------------------------------------------------------

/** AuthorSnapshot congelado: `displayName` obligatorio, `avatarUrl` opcional. */
export function buildAuthorSnapshot(input: {
  displayName: string
  avatarUrl?: string | null
}): AuthorSnapshot {
  return {
    displayName: input.displayName,
    avatarUrl: input.avatarUrl ?? null,
  }
}

// stub F.1: `buildQuoteSnapshot` se reconstruye en F.2 sobre el AST de Lexical.

/**
 * Valida que el comment target pertenece al mismo Post. El trigger
 * `enforce_comment_quote_same_post` es la red de seguridad en DB; este assert
 * da el error tipado temprano en la action.
 */
export function assertQuotedCommentBelongsToPost(
  quotedComment: { id: string; postId: string },
  postId: string,
): void {
  if (quotedComment.postId !== postId) {
    throw new InvalidQuoteTarget('cross_post', {
      quotedCommentId: quotedComment.id,
      expectedPostId: postId,
      actualPostId: quotedComment.postId,
    })
  }
}

/** Target deletado: no se puede crear una cita nueva sobre él. */
export function assertQuotedCommentAlive(quotedComment: QuoteSourceComment): void {
  if (quotedComment.deletedAt) {
    throw new InvalidQuoteTarget('not_found', { commentId: quotedComment.id })
  }
}
