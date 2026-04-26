/**
 * Tipos puros del slice `discussions`. Sin Next, React ni queries.
 *
 * Los enums se re-exportan directamente del Prisma client (`@prisma/client`).
 * Los shape de entidades son **views de dominio**: el server layer los resuelve
 * desde Prisma rows normalizando timestamps y filtrando columnas internas (version).
 *
 * Ver `docs/features/discussions/spec.md` § 4 (entidades) y § 14 (rich text).
 */

import type {
  ContentTargetKind as PrismaContentTargetKind,
  PlaceOpeningSource as PrismaPlaceOpeningSource,
  ReactionEmoji as PrismaReactionEmoji,
} from '@prisma/client'

export type ContentTargetKind = PrismaContentTargetKind
export type ReactionEmoji = PrismaReactionEmoji
export type PlaceOpeningSource = PrismaPlaceOpeningSource

export {
  ContentTargetKind as ContentTargetKindValues,
  PlaceOpeningSource as PlaceOpeningSourceValues,
  ReactionEmoji as ReactionEmojiValues,
} from '@prisma/client'

// ---------------------------------------------------------------
// Rich text (TipTap JSON AST)
// ---------------------------------------------------------------

/**
 * AST permitido por `richTextDocumentSchema`. Forma canónica de cualquier body
 * de Post o Comment. Cualquier nodo fuera de esta union se rechaza al parsear.
 *
 * La forma es recursiva: `Block.content` incluye otros bloques o inline nodes.
 * La profundidad máxima de listas se enforza en `invariants.assertListDepth`.
 */
export type RichTextDocument = {
  type: 'doc'
  content: RichTextBlockNode[]
}

export type RichTextBlockNode =
  | RichTextParagraph
  | RichTextHeading
  | RichTextBulletList
  | RichTextOrderedList
  | RichTextBlockquote
  | RichTextCodeBlock

export type RichTextParagraph = {
  type: 'paragraph'
  content?: RichTextInlineNode[]
}

export type RichTextHeading = {
  type: 'heading'
  attrs: { level: 2 | 3 }
  content?: RichTextInlineNode[]
}

export type RichTextBulletList = {
  type: 'bulletList'
  content: RichTextListItem[]
}

export type RichTextOrderedList = {
  type: 'orderedList'
  content: RichTextListItem[]
}

export type RichTextListItem = {
  type: 'listItem'
  content: RichTextBlockNode[]
}

export type RichTextBlockquote = {
  type: 'blockquote'
  content: RichTextBlockNode[]
}

export type RichTextCodeBlock = {
  type: 'codeBlock'
  content?: Array<{ type: 'text'; text: string }>
}

export type RichTextInlineNode = RichTextText | RichTextMention

export type RichTextText = {
  type: 'text'
  text: string
  marks?: RichTextMark[]
}

export type RichTextMention = {
  type: 'mention'
  attrs: { userId: string; label: string }
}

export type RichTextMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'code' }
  | {
      type: 'link'
      attrs: {
        href: string
        target: '_blank'
        rel: 'noopener noreferrer'
      }
    }

// ---------------------------------------------------------------
// Snapshots (congelados al momento de crear)
// ---------------------------------------------------------------

/**
 * Snapshot del autor al momento de crear (o al `leftAt`). Se persiste en
 * `authorSnapshot jsonb` y sobrevive la erasure 365d: cuando `authorUserId`
 * se nulifica, el render sigue mostrando el nombre/avatar congelados.
 */
export type AuthorSnapshot = {
  displayName: string
  avatarUrl: string | null
}

/**
 * Snapshot del comment citado al momento de responder. Congelado: no se
 * actualiza si el target se edita, oculta o borra.
 *
 * `bodyExcerpt` es texto plano derivado del AST (ver `richTextExcerpt`) para
 * preservar citas incluso si el body original excede UI.
 */
export type QuoteSnapshot = {
  commentId: string
  authorLabel: string
  bodyExcerpt: string
  createdAt: Date
}

// ---------------------------------------------------------------
// Entidades del dominio
// ---------------------------------------------------------------

export type PostId = string
export type CommentId = string
export type ReactionId = string
export type PlaceOpeningId = string
export type PostReadId = string

/**
 * Estado derivado del Post. Post.deletedAt ya no existe — borrar un post es
 * hard delete (la fila desaparece junto con comments, reads, flags y reactions).
 * Por eso la view nunca observa un Post en estado `DELETED`: o está visible,
 * o está oculto por admin, o no existe.
 */
export type PostState = 'VISIBLE' | 'HIDDEN'

/**
 * Estado derivado del target de una cita (un Comment). Los Comments son soft
 * delete — pueden quedar referenciados por un quote aun después de eliminarse.
 * Usado por `QuotePreview` para renderizar `[mensaje eliminado]` cuando el
 * target original ya no está.
 */
export type QuoteTargetState = 'VISIBLE' | 'DELETED'

/**
 * Subset del Event asociado al Post via auto-thread (F.E Fase 6). Sólo los
 * campos que la UI del thread necesita para renderizar header "Conversación
 * del evento: …" + badge "Cancelado". Null cuando el Post NO es thread de
 * evento (la mayoría de los Posts).
 *
 * Mantiene el slice discussions agnóstico al schema completo de Event —
 * sólo conoce los 3 campos visibles.
 */
export type PostEventLink = {
  id: string
  title: string
  cancelledAt: Date | null
}

export type Post = {
  id: PostId
  placeId: string
  authorUserId: string | null
  authorSnapshot: AuthorSnapshot
  title: string
  slug: string
  body: RichTextDocument | null
  createdAt: Date
  editedAt: Date | null
  hiddenAt: Date | null
  lastActivityAt: Date
  version: number
  /** Relación inversa al evento que generó este Post como thread. Null en
   *  Posts standalone. Se popula sólo en queries que lo solicitan vía
   *  `include: { event: ... }` (ver `findPostBySlug`). */
  event: PostEventLink | null
}

/**
 * Subset de un reader para `<ReaderStack>` en la lista de threads (R.6).
 * Mismos campos que `PostReader` pero sin `readAt` (no se muestra en el stack).
 */
export type ReaderForStack = {
  userId: string
  displayName: string
  avatarUrl: string | null
}

/**
 * Post enriquecido para la lista (`/conversations`):
 * - `lastReadAt`: dot de novedad (`hasUnread = lastActivityAt > (lastReadAt ?? 0)`).
 *   Null si el viewer nunca dwelleó o no hay viewer autenticado.
 * - `snippet` (R.6): primeros 140 chars del body plain text via `richTextExcerpt`.
 *   Cadena vacía si el body es null.
 * - `commentCount` (R.6): comments activos del post (deletedAt IS NULL).
 *   Soft-deleted excluidos para consistency con la UI.
 * - `readerSample` (R.6): top 4 readers de la apertura actual del place para
 *   `<ReaderStack>` en cada row. Array vacío si el place no tiene opening
 *   activa o si el post no tiene lectores aún.
 * - `isFeatured` (R.6): `true` solo para el primer post de la primera página
 *   (sin cursor). Heurística simple — el thread con `lastActivityAt` más
 *   reciente. Diferenciación visual `<FeaturedThreadCard>` vs `<ThreadRow>`.
 */
export type PostListView = Post & {
  lastReadAt: Date | null
  snippet: string
  commentCount: number
  readerSample: ReaderForStack[]
  isFeatured: boolean
}

export type Comment = {
  id: CommentId
  postId: PostId
  placeId: string
  authorUserId: string | null
  authorSnapshot: AuthorSnapshot
  body: RichTextDocument
  quotedCommentId: CommentId | null
  quotedSnapshot: QuoteSnapshot | null
  createdAt: Date
  editedAt: Date | null
  deletedAt: Date | null
  version: number
}

export type Reaction = {
  id: ReactionId
  targetType: ContentTargetKind
  targetId: string
  placeId: string
  userId: string
  emoji: ReactionEmoji
  createdAt: Date
}

export type PlaceOpening = {
  id: PlaceOpeningId
  placeId: string
  startAt: Date
  endAt: Date | null
  source: PlaceOpeningSource
  createdAt: Date
}

export type PostRead = {
  id: PostReadId
  postId: PostId
  userId: string
  placeOpeningId: PlaceOpeningId
  readAt: Date
  dwellMs: number
}

/** Input mínimo para resolver un snapshot de cita. */
export type QuoteSourceComment = {
  id: CommentId
  authorSnapshot: AuthorSnapshot
  body: RichTextDocument
  createdAt: Date
  deletedAt: Date | null
}
