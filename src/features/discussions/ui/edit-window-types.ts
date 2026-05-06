/**
 * Tipos compartidos entre `EditWindowActions` y `EditWindowConfirmDelete`.
 * Vive como archivo separado para romper ciclos (el root importa los
 * sub-components, y éstos necesitan los tipos).
 *
 * El editor inline 60s se restaura post-MVP — hoy solo el flujo "delete"
 * está cableado. El campo `body` se preserva en el tipo para que el
 * delete confirm pueda mostrar excerpt si el producto lo decide en el
 * futuro.
 */

import type { LexicalDocument } from '@/features/rich-text/public'

export type PostSubject = {
  kind: 'post'
  postId: string
  title: string
  body: LexicalDocument | null
  createdAt: Date
  version: number
  placeSlug: string
}

export type CommentSubject = {
  kind: 'comment'
  body: LexicalDocument | null
  commentId: string
  createdAt: Date
  version: number
}

export type EditWindowSubject = PostSubject | CommentSubject

export type EditSessionState =
  | { state: 'loading' }
  | { state: 'ready'; session: { token: string; openedAt: string } | null }
  | { state: 'error'; message: string }
