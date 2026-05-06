import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import type {
  AuthorSnapshot,
  Comment,
  QuoteSnapshot,
  QuoteTargetState,
} from '@/features/discussions/domain/types'
import type { Cursor } from '@/features/discussions/server/queries/_shared'

/** Queries Comment-centric. UI consume vía `public.ts`. */

export const COMMENT_PAGE_SIZE = 50

/** `body=null` cuando el comment está deletado y el actor no es admin →
 *  UI renderiza `[mensaje eliminado]`. `quoteState` derivado server-side
 *  via JOIN con `quotedComment` (1 RTT). */
// stub F.1: body retipado a unknown durante migración a Lexical (F.2).
export type CommentView = Omit<Comment, 'body'> & {
  body: unknown
  quoteState: QuoteTargetState | null
}

const commentInclude = {
  quotedComment: { select: { id: true, deletedAt: true } },
} satisfies Prisma.CommentInclude

type CommentRow = Prisma.CommentGetPayload<{ include: typeof commentInclude }>

export async function findCommentById(commentId: string): Promise<CommentView | null> {
  const row = await prisma.comment.findUnique({
    where: { id: commentId },
    include: commentInclude,
  })
  if (!row) return null
  return mapComment(row, true)
}

/** Shape mínimo para construir el `QuoteSnapshot` de un comment nuevo. */
export type QuoteSource = {
  id: string
  postId: string
  authorSnapshot: AuthorSnapshot
  // stub F.1, retipado en F.2 a LexicalDocument
  body: unknown
  createdAt: Date
  deletedAt: Date | null
}

export async function findQuoteSource(commentId: string): Promise<QuoteSource | null> {
  const row = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      postId: true,
      authorSnapshot: true,
      body: true,
      createdAt: true,
      deletedAt: true,
    },
  })
  if (!row) return null
  return {
    id: row.id,
    postId: row.postId,
    authorSnapshot: row.authorSnapshot as unknown as AuthorSnapshot,
    // stub F.1, retipado en F.2 a LexicalDocument
    body: row.body,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  }
}

/** Cursor keyset (createdAt DESC, id DESC). Spec § 13 "últimos 50 + cursor". */
export async function listCommentsByPost(params: {
  postId: string
  cursor?: Cursor | null
  includeDeleted?: boolean
  pageSize?: number
}): Promise<{ items: CommentView[]; nextCursor: Cursor | null }> {
  const pageSize = params.pageSize ?? COMMENT_PAGE_SIZE
  const where: Prisma.CommentWhereInput = {
    postId: params.postId,
    ...(params.cursor
      ? {
          OR: [
            { createdAt: { lt: params.cursor.createdAt } },
            { createdAt: params.cursor.createdAt, id: { lt: params.cursor.id } },
          ],
        }
      : {}),
  }

  const rows = await prisma.comment.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: pageSize + 1,
    include: commentInclude,
  })

  const hasMore = rows.length > pageSize
  const sliced = hasMore ? rows.slice(0, pageSize) : rows
  const items = sliced.map((r) => mapComment(r, params.includeDeleted ?? false))
  const last = items[items.length - 1]
  const nextCursor = hasMore && last ? { createdAt: last.createdAt, id: last.id } : null
  return { items, nextCursor }
}

function mapComment(row: CommentRow, includeDeletedBody = false): CommentView {
  const isDeleted = row.deletedAt !== null
  // FK orphan (quotedCommentId !== null + quotedComment === null) → 'VISIBLE'.
  const quoteState: QuoteTargetState | null =
    row.quotedCommentId === null
      ? null
      : !row.quotedComment
        ? 'VISIBLE'
        : row.quotedComment.deletedAt !== null
          ? 'DELETED'
          : 'VISIBLE'
  return {
    id: row.id,
    postId: row.postId,
    placeId: row.placeId,
    authorUserId: row.authorUserId,
    authorSnapshot: row.authorSnapshot as unknown as AuthorSnapshot,
    // stub F.1, retipado en F.2 a LexicalDocument
    body: isDeleted && !includeDeletedBody ? null : row.body,
    quotedCommentId: row.quotedCommentId,
    quotedSnapshot: (row.quotedSnapshot as unknown as QuoteSnapshot | null) ?? null,
    quoteState,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    version: row.version,
  }
}
