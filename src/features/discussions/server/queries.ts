import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import type { LexicalDocument } from '@/features/rich-text/public'
import type {
  AuthorSnapshot,
  Post,
  PostEventLink,
  PostListView,
  ReaderForStack,
  Comment,
  QuoteSnapshot,
} from '../domain/types'
import type { PostListFilter } from '../domain/filter'
import { findOrCreateCurrentOpening } from '../presence/public.server'

/**
 * Vista de Comment para lectores: cuando el comment está deletado y el actor no es
 * admin, `body` viaja `null` para que la UI renderice placeholder `[mensaje eliminado]`.
 * El tipo `Comment` del dominio mantiene `body` obligatorio — los comments persistidos
 * siempre tienen body, pero la proyección para render puede omitirlo.
 */
export type CommentView = Omit<Comment, 'body'> & { body: LexicalDocument | null }

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
    include: {
      event: { select: { id: true, title: true, cancelledAt: true } },
      libraryItem: {
        select: {
          id: true,
          archivedAt: true,
          category: { select: { slug: true } },
        },
      },
    },
  })
  if (!row) return null
  return mapPostWithEvent(row, row.event, row.libraryItem)
}

/**
 * Lookup por unique `(placeId, slug)`. Retorna `null` si no existe; la page
 * de detalle lanza `notFound()` desde ahí.
 *
 * Incluye relaciones inversas:
 *  - `Post.event` para que `PostDetail` renderice el header del evento.
 *  - `Post.libraryItem` (R.7.9) para que la page de discusiones haga
 *    redirect 308 a la URL canónica `/library/[cat]/[slug]` cuando el
 *    Post es un item de biblioteca.
 *
 * En posts standalone ambos son null.
 */
export async function findPostBySlug(placeId: string, slug: string): Promise<Post | null> {
  const row = await prisma.post.findUnique({
    where: { placeId_slug: { placeId, slug } },
    include: {
      event: { select: { id: true, title: true, cancelledAt: true } },
      libraryItem: {
        select: {
          id: true,
          archivedAt: true,
          category: { select: { slug: true } },
        },
      },
    },
  })
  if (!row) return null
  return mapPostWithEvent(row, row.event, row.libraryItem)
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
  filter?: PostListFilter
}): Promise<{ items: PostListView[]; nextCursor: Cursor | null }> {
  const filter: PostListFilter = params.filter ?? 'all'

  // Defensive: `participating` requiere viewerUserId. En la práctica,
  // /conversations es gated así que el viewer siempre existe. Pero si
  // algún caller invoca sin viewer + filter='participating', devolver
  // lista vacía sin error en vez de filtrar por null (que matchearía
  // posts de ex-miembros — semánticamente incorrecto).
  if (filter === 'participating' && !params.viewerUserId) {
    return { items: [], nextCursor: null }
  }

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
    ...buildFilterWhere(filter, params.viewerUserId),
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
    // stub F.1: snippet derivado del rich-text se reintroduce en F.2 con Lexical AST.
    snippet: '',
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
 * Construye el `WHERE` parcial según el filter activo. Pure (no Prisma
 * client). Combinado con el `where` base via spread en `listPostsByPlace`.
 *
 * - `all`: sin filter adicional.
 * - `unanswered`: posts sin comments activos (`deletedAt IS NULL`).
 *   Prisma traduce a `NOT EXISTS (SELECT 1 FROM "Comment" WHERE
 *   "postId" = "Post"."id" AND "deletedAt" IS NULL)`. Cubierto por
 *   índice `Comment(postId)` existente.
 * - `participating`: viewer es autor del post O hizo al menos un comment
 *   activo. Prisma traduce a `WHERE "authorUserId" = $1 OR EXISTS
 *   (SELECT 1 FROM "Comment" WHERE "postId" = "Post"."id" AND
 *   "authorUserId" = $1 AND "deletedAt" IS NULL)`. Asume `viewerUserId`
 *   defined (gateado en `listPostsByPlace`).
 */
function buildFilterWhere(
  filter: PostListFilter,
  viewerUserId: string | undefined,
): Prisma.PostWhereInput {
  switch (filter) {
    case 'all':
      return {}
    case 'unanswered':
      return { comments: { none: { deletedAt: null } } }
    case 'participating': {
      // Gateado en `listPostsByPlace`: si filter='participating' y
      // viewerUserId es undefined, retornamos `{items:[], nextCursor:null}`
      // antes de invocar este helper. Asserción defensiva acá para
      // satisfacer el typecheck de Prisma (no acepta `undefined`,
      // espera `string | null`).
      if (!viewerUserId) return {}
      return {
        OR: [
          { authorUserId: viewerUserId },
          { comments: { some: { authorUserId: viewerUserId, deletedAt: null } } },
        ],
      }
    }
  }
}

/**
 * Proyección de un lector del post durante una apertura específica. Shape
 * consumido por el componente UI `PostReadersBlock`. El `userId` permite
 * linkear al perfil contextual del miembro (`/m/<userId>`).
 *
 * NOTA (B.1 migración presence): el shape canónico ahora vive en
 * `presence/server/queries/post-readers.ts`. Este export se mantiene
 * temporalmente porque el legacy `ui/post-readers-block.tsx` lo consume vía
 * `'../server/queries'`. Cuando B.2 borre ese UI legacy, este type se elimina
 * también (ya no hay otros consumers).
 */
export type PostReader = {
  userId: string
  displayName: string
  avatarUrl: string | null
  readAt: Date
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
  body: LexicalDocument
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
    body: row.body as unknown as LexicalDocument,
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
  return mapPostWithEvent(row, null, null)
}

type LibraryItemJoinRow = {
  id: string
  archivedAt: Date | null
  category: { slug: string }
}

/**
 * Mapper extendido que incluye relaciones inversas `Post.event` y
 * `Post.libraryItem` (R.7.9). Cuando el caller hace `include: { … }` y
 * obtiene la subselección, la pasa acá. Sin la relación, ambos son null
 * por default — la UI los trata como Post standalone.
 */
function mapPostWithEvent(
  row: PostRow,
  event: PostEventLink | null,
  libraryItem: LibraryItemJoinRow | null,
): Post {
  return {
    id: row.id,
    placeId: row.placeId,
    authorUserId: row.authorUserId,
    authorSnapshot: row.authorSnapshot as unknown as AuthorSnapshot,
    title: row.title,
    slug: row.slug,
    // Prisma.JsonValue → LexicalDocument: el shape lo enforce el schema Zod
    // al persistir; acá confiamos en el runtime (mismo patrón que authorSnapshot).
    body: (row.body as unknown as LexicalDocument | null) ?? null,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    hiddenAt: row.hiddenAt,
    lastActivityAt: row.lastActivityAt,
    version: row.version,
    event,
    libraryItem: libraryItem
      ? {
          id: libraryItem.id,
          categorySlug: libraryItem.category.slug,
          archivedAt: libraryItem.archivedAt,
        }
      : null,
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
    // Prisma.JsonValue → LexicalDocument: shape enforced por Zod al persistir.
    body: isDeleted && !includeDeletedBody ? null : (row.body as unknown as LexicalDocument),
    quotedCommentId: row.quotedCommentId,
    quotedSnapshot: (row.quotedSnapshot as unknown as QuoteSnapshot | null) ?? null,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    deletedAt: row.deletedAt,
    version: row.version,
  }
}
