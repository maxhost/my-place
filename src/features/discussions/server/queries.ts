import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import type {
  AuthorSnapshot,
  Post,
  PostEventLink,
  PostListView,
  ReaderForStack,
  Comment,
  QuoteSnapshot,
  RichTextDocument,
} from '../domain/types'
import { richTextExcerpt } from '../domain/rich-text'
import { findOrCreateCurrentOpening } from './place-opening'

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
  const row = await prisma.post.findUnique({
    where: { id: postId },
    include: { event: { select: { id: true, title: true, cancelledAt: true } } },
  })
  if (!row) return null
  return mapPostWithEvent(row, row.event)
}

/**
 * Lookup por unique `(placeId, slug)`. Retorna `null` si no existe; la page
 * de detalle lanza `notFound()` desde ahí.
 *
 * Incluye la relación inversa `Post.event` para que `PostDetail` pueda
 * renderizar el header "Conversación del evento: …" + badge "Cancelado"
 * sin round-trips adicionales (F.E Fase 6 — relación bidireccional
 * Event↔Post). En posts standalone `event` es null.
 */
export async function findPostBySlug(placeId: string, slug: string): Promise<Post | null> {
  const row = await prisma.post.findUnique({
    where: { placeId_slug: { placeId, slug } },
    include: { event: { select: { id: true, title: true, cancelledAt: true } } },
  })
  if (!row) return null
  return mapPostWithEvent(row, row.event)
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
  const postIds = pageRows.map((r) => r.id)

  // R.6.1: agregamos commentCount + readerSample al shape del view en
  // paralelo con lastReadAt. Si la opening del place falla (place sin
  // hours configuradas, race condition), readers cae a Map vacío sin
  // romper el render — los rows muestran "0 lectores" igual que cuando
  // no hay readers reales. La opening se cachea con React.cache, así
  // que esta llamada es 0 round-trips si el caller (page o layout) ya
  // la disparó.
  const [lastReadByPostId, commentCountByPostId, readersByPostId] = await Promise.all([
    fetchLastReadByPostId({
      viewerUserId: params.viewerUserId,
      postIds,
    }),
    fetchCommentCountByPostId(postIds),
    fetchReadersSampleByPostId({
      placeId: params.placeId,
      postIds,
    }),
  ])

  const items: PostListView[] = pageRows.map((row, idx) => ({
    ...mapPost(row),
    lastReadAt: lastReadByPostId.get(row.id) ?? null,
    snippet: row.body ? richTextExcerpt(row.body as RichTextDocument, 140) : '',
    commentCount: commentCountByPostId.get(row.id) ?? 0,
    readerSample: readersByPostId.get(row.id) ?? [],
    // Featured solo el primer post de la primera página (sin cursor).
    // Páginas subsiguientes (cursor !== null) no destacan ningún post.
    isFeatured: idx === 0 && !params.cursor,
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

/**
 * Cuenta comments activos (deletedAt IS NULL) por `postId`. Soft-deleted
 * excluidos para consistency con la UI que no muestra placeholders en el
 * count. Un solo groupBy. Sin posts, short-circuit a Map vacío.
 */
async function fetchCommentCountByPostId(postIds: string[]): Promise<Map<string, number>> {
  if (postIds.length === 0) return new Map()
  const rows = await prisma.comment.groupBy({
    by: ['postId'],
    where: { postId: { in: postIds }, deletedAt: null },
    _count: { id: true },
  })
  const map = new Map<string, number>()
  for (const row of rows) {
    map.set(row.postId, row._count.id)
  }
  return map
}

/**
 * Top 4 readers por `postId` de la **apertura actual** del place — para el
 * `<ReaderStack>` en la lista de threads (R.6).
 *
 * Approach: una sola query `findMany` sobre `PostRead` filtrada por
 * `placeOpeningId = currentOpeningId AND postId IN (...)`, joins a `User`
 * para `displayName` + `avatarUrl`, ordered por `readAt DESC`. Filtramos
 * client-side al top 4 por post. Aceptable porque el cap es 150
 * miembros/place — el peor caso es ~150 readers por post × 50 posts =
 * 7500 rows en una page, manageable.
 *
 * Si el place no tiene opening activa (`unconfigured` o ventana cerrada),
 * cae a Map vacío silencioso. El `<ReaderStack>` con array vacío no se
 * renderiza (mismo silencio que `<PostReadersBlock>` en el detail).
 *
 * **Ex-miembros excluidos**: solo readers con `Membership` activa
 * (`leftAt IS NULL`) en el mismo place aparecen — alineado con
 * `listReadersByPost` en el detail (derecho al olvido estructurado).
 */
async function fetchReadersSampleByPostId(params: {
  placeId: string
  postIds: string[]
}): Promise<Map<string, ReaderForStack[]>> {
  if (params.postIds.length === 0) return new Map()
  const opening = await findOrCreateCurrentOpening(params.placeId).catch(() => null)
  if (!opening) return new Map()

  const rows = await prisma.postRead.findMany({
    where: {
      placeOpeningId: opening.id,
      postId: { in: params.postIds },
      user: {
        memberships: { some: { placeId: params.placeId, leftAt: null } },
      },
    },
    orderBy: { readAt: 'desc' },
    select: {
      postId: true,
      userId: true,
      user: { select: { displayName: true, avatarUrl: true } },
    },
  })

  const map = new Map<string, ReaderForStack[]>()
  for (const row of rows) {
    const existing = map.get(row.postId) ?? []
    if (existing.length >= 4) continue
    existing.push({
      userId: row.userId,
      displayName: row.user.displayName,
      avatarUrl: row.user.avatarUrl,
    })
    map.set(row.postId, existing)
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
  return mapPostWithEvent(row, null)
}

/**
 * Mapper extendido que incluye la relación inversa `Post.event`. Cuando el
 * caller hace `include: { event: ... }` y obtiene la subselección, la pasa
 * acá. Si no se pidió la relación, `event` es null por default — la UI lo
 * trata como Post standalone.
 */
function mapPostWithEvent(row: PostRow, event: PostEventLink | null): Post {
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
    event,
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
