import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import type {
  AuthorSnapshot,
  Post,
  PostEventLink,
  PostListView,
} from '@/features/discussions/domain/types'
import type { PostListFilter } from '@/features/discussions/domain/filter'
import type { Cursor } from '@/features/discussions/server/queries/_shared'
import {
  fetchCommentCountByPostId,
  fetchLastReadByPostId,
  fetchReadersSampleByPostId,
} from '@/features/discussions/presence/public.server'

/**
 * Queries Post-centric del slice `discussions` (find/list de `Post`). Lo
 * relativo a `PostRead` vive en `post-readers.ts`; comments, en
 * `comments.ts`. Sólo este subdirectorio + `actions/*` tocan Prisma.
 *
 * Filtrado por visibilidad se decide en el call site según `isAdmin` — admin
 * ve contenido oculto/deletado para moderar; miembros no.
 */

export const POST_PAGE_SIZE = 50

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

// ---------------------------------------------------------------
// Mappers (Prisma row → dominio)
// ---------------------------------------------------------------

type PostRow = Prisma.PostGetPayload<Record<string, never>>

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
    // stub F.1, retipado en F.2 a LexicalDocument
    body: row.body ?? null,
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
