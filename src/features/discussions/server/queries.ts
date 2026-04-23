import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import type {
  AuthorSnapshot,
  Post,
  PostListView,
  Comment,
  QuoteSnapshot,
  RichTextDocument,
} from '../domain/types'

/**
 * Vista de Comment para lectores: cuando el comment está deletado y el actor no es
 * admin, `body` viaja `null` para que la UI renderice placeholder `[mensaje eliminado]`.
 * El tipo `Comment` del dominio mantiene `body` obligatorio — los comments persistidos
 * siempre tienen body, pero la proyección para render puede omitirlo.
 */
export type CommentView = Omit<Comment, 'body'> & { body: RichTextDocument | null }

/**
 * Queries del slice `discussions`. Sólo este archivo + `actions/*` tocan Prisma.
 * El resto del slice consume vía `public.ts`.
 *
 * Filtrado por visibilidad se decide en el call site según `isAdmin` — admin
 * ve contenido oculto/deletado para moderar; miembros no.
 */

export const POST_PAGE_SIZE = 50
export const COMMENT_PAGE_SIZE = 50

type Cursor = { createdAt: Date; id: string }

// ---------------------------------------------------------------
// Posts
// ---------------------------------------------------------------

export async function findPostById(postId: string): Promise<Post | null> {
  const row = await prisma.post.findUnique({ where: { id: postId } })
  if (!row) return null
  return mapPost(row)
}

/**
 * Lookup por unique `(placeId, slug)`. Retorna `null` si no existe; la page
 * de detalle lanza `notFound()` desde ahí.
 */
export async function findPostBySlug(placeId: string, slug: string): Promise<Post | null> {
  const row = await prisma.post.findUnique({
    where: { placeId_slug: { placeId, slug } },
  })
  if (!row) return null
  return mapPost(row)
}

/**
 * Lista posts de un place con cursor keyset sobre `(createdAt DESC, id DESC)`.
 * Orden por `lastActivityAt DESC` para "vivos primero"; `id` es tiebreaker.
 *
 * Admin invoca con `includeHidden=true` para moderación. Posts eliminados no
 * se listan porque el row ya no existe (hard delete — ver C.G.1).
 *
 * Cuando se pasa `viewerUserId`, adjunta `lastReadAt` por post (máximo `readAt`
 * de `PostRead` del viewer) para derivar el dot de novedad en la UI. Sin viewer
 * (SSR sin sesión autenticada), `lastReadAt` queda `null` en todos los posts.
 */
export async function listPostsByPlace(params: {
  placeId: string
  cursor?: Cursor | null
  includeHidden?: boolean
  pageSize?: number
  viewerUserId?: string
}): Promise<{ items: PostListView[]; nextCursor: Cursor | null }> {
  const pageSize = params.pageSize ?? POST_PAGE_SIZE
  const where: Prisma.PostWhereInput = {
    placeId: params.placeId,
    ...(params.includeHidden ? {} : { hiddenAt: null }),
    ...(params.cursor
      ? {
          OR: [
            { lastActivityAt: { lt: params.cursor.createdAt } },
            {
              lastActivityAt: params.cursor.createdAt,
              id: { lt: params.cursor.id },
            },
          ],
        }
      : {}),
  }

  const rows = await prisma.post.findMany({
    where,
    orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
    take: pageSize + 1,
  })

  const hasMore = rows.length > pageSize
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows
  const lastReadByPostId = await fetchLastReadByPostId({
    viewerUserId: params.viewerUserId,
    postIds: pageRows.map((r) => r.id),
  })
  const items: PostListView[] = pageRows.map((row) => ({
    ...mapPost(row),
    lastReadAt: lastReadByPostId.get(row.id) ?? null,
  }))
  const last = items[items.length - 1]
  const nextCursor = hasMore && last ? { createdAt: last.lastActivityAt, id: last.id } : null
  return { items, nextCursor }
}

/**
 * Proyección de un lector del post durante una apertura específica. Shape
 * consumido por el componente UI `PostReadersBlock`. El `userId` permite
 * linkear al perfil contextual del miembro (`/m/<userId>`).
 */
export type PostReader = {
  userId: string
  displayName: string
  avatarUrl: string | null
  readAt: Date
}

/**
 * Lista lectores de un post durante una apertura específica (`placeOpeningId`).
 *
 * Reglas de filtrado (en línea con la ontología `docs/ontologia/
 * conversaciones.md § Tres` y spec § PostRead):
 *
 * - **Ex-miembros excluidos**: solo lectores con `Membership` activa
 *   (`leftAt IS NULL`) en el mismo place aparecen. Derecho al olvido
 *   estructurado: quien salió no debe seguir visible como lector.
 * - **Viewer excluido opcionalmente**: `excludeUserId` filtra al viewer
 *   actual — simetría con `ThreadPresence` que oculta al viewer de la
 *   presencia live.
 * - **Orden `readAt DESC`**: el lector más reciente primero (coherente con
 *   el texto ontológico "hasta ahora").
 *
 * Sin límite de filas — el cap es 150 miembros/place por invariante del
 * dominio; el consumidor UI hace slice(0, 8) visual. Index
 * `(postId, placeOpeningId)` garantiza que la query es sub-milisegundo.
 */
export async function listReadersByPost(params: {
  postId: string
  placeId: string
  placeOpeningId: string
  excludeUserId?: string
}): Promise<PostReader[]> {
  const rows = await prisma.postRead.findMany({
    where: {
      postId: params.postId,
      placeOpeningId: params.placeOpeningId,
      ...(params.excludeUserId ? { userId: { not: params.excludeUserId } } : {}),
      user: {
        memberships: {
          some: {
            placeId: params.placeId,
            leftAt: null,
          },
        },
      },
    },
    select: {
      userId: true,
      readAt: true,
      user: { select: { displayName: true, avatarUrl: true } },
    },
    orderBy: { readAt: 'desc' },
  })
  return rows.map((row) => ({
    userId: row.userId,
    displayName: row.user.displayName,
    avatarUrl: row.user.avatarUrl,
    readAt: row.readAt,
  }))
}

/**
 * Agrupa `PostRead` por `postId` tomando el `max(readAt)` del viewer. Un único
 * round-trip extra; sin viewer o sin posts, short-circuit a Map vacío.
 */
async function fetchLastReadByPostId(params: {
  viewerUserId: string | undefined
  postIds: string[]
}): Promise<Map<string, Date>> {
  if (!params.viewerUserId || params.postIds.length === 0) return new Map()
  const rows = await prisma.postRead.groupBy({
    by: ['postId'],
    where: { userId: params.viewerUserId, postId: { in: params.postIds } },
    _max: { readAt: true },
  })
  const map = new Map<string, Date>()
  for (const row of rows) {
    if (row._max.readAt) map.set(row.postId, row._max.readAt)
  }
  return map
}

// ---------------------------------------------------------------
// Comments
// ---------------------------------------------------------------

export async function findCommentById(commentId: string): Promise<CommentView | null> {
  const row = await prisma.comment.findUnique({ where: { id: commentId } })
  if (!row) return null
  return mapComment(row, true)
}

/**
 * Shape mínimo para construir el `QuoteSnapshot` de un comment nuevo. Además de
 * los campos del dominio, devuelve `postId` para validar cross-post en la action.
 */
export type QuoteSource = {
  id: string
  postId: string
  authorSnapshot: AuthorSnapshot
  body: RichTextDocument
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
    body: row.body as unknown as RichTextDocument,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  }
}

/**
 * Lista comments de un post con cursor keyset sobre `(createdAt DESC, id DESC)`.
 * MVP pagina hacia atrás desde los más recientes — spec § 13 "últimos 50 + cursor".
 *
 * Deleted comments se devuelven con `body=null` (render placeholder) para que la UI
 * preserve la posición y el flujo de la conversación. Admin los ve completos con
 * `includeDeleted=true`.
 */
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
  })

  const hasMore = rows.length > pageSize
  const sliced = hasMore ? rows.slice(0, pageSize) : rows
  const items = sliced.map((r) => mapComment(r, params.includeDeleted ?? false))
  const last = items[items.length - 1]
  const nextCursor = hasMore && last ? { createdAt: last.createdAt, id: last.id } : null
  return { items, nextCursor }
}

// ---------------------------------------------------------------
// Mappers (Prisma row → dominio)
// ---------------------------------------------------------------

type PostRow = Prisma.PostGetPayload<Record<string, never>>
type CommentRow = Prisma.CommentGetPayload<Record<string, never>>

function mapPost(row: PostRow): Post {
  return {
    id: row.id,
    placeId: row.placeId,
    authorUserId: row.authorUserId,
    authorSnapshot: row.authorSnapshot as unknown as AuthorSnapshot,
    title: row.title,
    slug: row.slug,
    body: (row.body as unknown as RichTextDocument | null) ?? null,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    hiddenAt: row.hiddenAt,
    lastActivityAt: row.lastActivityAt,
    version: row.version,
  }
}

function mapComment(row: CommentRow, includeDeletedBody = false): CommentView {
  const isDeleted = row.deletedAt !== null
  return {
    id: row.id,
    postId: row.postId,
    placeId: row.placeId,
    authorUserId: row.authorUserId,
    authorSnapshot: row.authorSnapshot as unknown as AuthorSnapshot,
    body: isDeleted && !includeDeletedBody ? null : (row.body as unknown as RichTextDocument),
    quotedCommentId: row.quotedCommentId,
    quotedSnapshot: (row.quotedSnapshot as unknown as QuoteSnapshot | null) ?? null,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    version: row.version,
  }
}
