/**
 * Tipos compartidos entre `EditWindowActions` y `EditWindowConfirmDelete`.
 * Vive como archivo separado para romper ciclos (el root importa los
 * sub-components, y éstos necesitan los tipos).
 *
 * stub F.1: el editor inline (`EditWindowForm`) se eliminó durante la
 * migración a Lexical; F.3 (comments) y F.4 (posts) reintroducen el flujo
 * completo de edición 60s con el composer Lexical.
 */

// stub F.1: body retipado de RichTextDocument a unknown durante migración a Lexical (F.2).

export type PostSubject = {
  kind: 'post'
  postId: string
  title: string
  body: unknown
  createdAt: Date
  version: number
  placeSlug: string
}

export type CommentSubject = {
  kind: 'comment'
  body: unknown
  commentId: string
  createdAt: Date
  version: number
}

export type EditWindowSubject = PostSubject | CommentSubject

export type EditSessionState =
  | { state: 'loading' }
  | { state: 'ready'; session: { token: string; openedAt: string } | null }
  | { state: 'error'; message: string }
