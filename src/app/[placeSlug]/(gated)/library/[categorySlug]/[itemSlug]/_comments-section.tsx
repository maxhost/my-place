import 'server-only'
import { prisma } from '@/db/client'
import { logger } from '@/shared/lib/logger'
import { ReactionBar, type QuoteTargetState } from '@/features/discussions/public'
import {
  CommentThread,
  PostReadersBlock,
  aggregateReactions,
  findOrCreateCurrentOpening,
  listCommentsByPost,
  listReadersByPost,
  reactionMapKey,
  resolveViewerForPlace,
  type PostReader,
  type ReactionAggregationMap,
} from '@/features/discussions/public.server'
import { buildMentionResolvers } from '@/app/[placeSlug]/(gated)/_mention-resolvers'

type CommentsSectionProps = {
  placeId: string
  placeSlug: string
  postId: string
}

/**
 * Streamed section: ReactionBar(POST) + readers + comments + reactions
 * (POST + comments en una sola call) + quote state. Vive bajo `<Suspense>`
 * en el page para que el shell + LibraryItemHeaderBar pinten primero
 * (~150ms post-TTFB). Las queries acá son las más pesadas: lista de
 * comments + agregación batch + readers query + quote state JOIN.
 *
 * Streaming agresivo (post-Sesión perf): el page YA NO pre-fetcha viewer
 * y opening — esta sección los resuelve internamente. `React.cache`
 * dedupea con `<LibraryItemContent>` y `<LibraryItemHeaderActions>` que
 * también piden viewer.
 *
 * Ver `docs/architecture.md` § "Streaming agresivo del shell".
 */
export async function CommentsSection({ placeId, placeSlug, postId }: CommentsSectionProps) {
  // Group 0: viewer + opening en paralelo. Ambos cacheados via React.cache
  // dentro del mismo request, así que `<LibraryItemContent>` arriba ya disparó
  // la viewer query — esta no incurre round-trip extra.
  const [viewer, opening] = await Promise.all([
    resolveViewerForPlace({ placeSlug }),
    findOrCreateCurrentOpening(placeId).catch((err: unknown) => {
      logger.error({ err, placeId }, 'failed to materialize opening')
      return null
    }),
  ])
  const viewerUserId = viewer.actorId
  const viewerIsAdmin = viewer.isAdmin
  const placeOpeningId = opening?.id ?? null

  // Group 1: lista de comments (gating reactions/quoteState que dependen de los
  // ids) + readers (independiente de los comments — sólo necesita postId). Antes
  // readers viajaba en el group 2 esperando innecesariamente al fetch de comments.
  const [{ items: comments, nextCursor }, readers] = await Promise.all([
    listCommentsByPost({
      postId,
      includeDeleted: viewerIsAdmin,
    }),
    placeOpeningId
      ? listReadersByPost({
          postId,
          placeId,
          placeOpeningId,
          excludeUserId: viewerUserId,
        })
      : Promise.resolve([] as PostReader[]),
  ])

  // Group 2: reactions (POST + comments en una sola call) + quoteState — ambas
  // dependen de los comment ids. Combinar POST + comments en `targets` ahorra
  // 1 round-trip respecto de agregarlos por separado.
  const [reactionsByKey, quoteStateByCommentId] = await Promise.all([
    aggregateReactions({
      targets: [
        { type: 'POST', id: postId },
        ...comments.map((c) => ({ type: 'COMMENT' as const, id: c.id })),
      ],
      viewerUserId,
    }) as Promise<ReactionAggregationMap>,
    resolveQuoteTargetStates(comments),
  ])

  const mentionResolvers = buildMentionResolvers({ placeId })

  return (
    <>
      <div className="px-3 pt-4">
        <ReactionBar
          targetType="POST"
          targetId={postId}
          initial={reactionsByKey.get(reactionMapKey('POST', postId)) ?? []}
        />
      </div>

      <div className="mt-3">
        <PostReadersBlock readers={readers} />
      </div>

      <CommentThread
        postId={postId}
        placeId={placeId}
        placeSlug={placeSlug}
        viewerUserId={viewerUserId}
        viewerIsAdmin={viewerIsAdmin}
        items={comments}
        nextCursor={
          nextCursor ? { createdAt: nextCursor.createdAt.toISOString(), id: nextCursor.id } : null
        }
        reactionsByKey={reactionsByKey}
        quoteStateByCommentId={quoteStateByCommentId}
        mentionResolvers={mentionResolvers}
      />
    </>
  )
}

/**
 * Resuelve el estado actual (VISIBLE/DELETED) de todos los comments citados
 * presentes en la página. Permite al renderer mostrar `[mensaje eliminado]`
 * cuando el target fue borrado desde que se congeló el snapshot. Una sola
 * query `IN (...)` sobre los ids.
 */
async function resolveQuoteTargetStates(
  comments: Array<{ quotedCommentId: string | null }>,
): Promise<Map<string, QuoteTargetState>> {
  const ids = comments.map((c) => c.quotedCommentId).filter((v): v is string => v !== null)
  if (ids.length === 0) return new Map()
  const rows = await prisma.comment.findMany({
    where: { id: { in: ids } },
    select: { id: true, deletedAt: true },
  })
  const map = new Map<string, QuoteTargetState>()
  for (const row of rows) {
    map.set(row.id, row.deletedAt ? 'DELETED' : 'VISIBLE')
  }
  return map
}

/**
 * Skeleton minimal para el `<Suspense fallback>` mientras strima la
 * sección de comments. Reproduce a grosso modo: bloque de readers + lista
 * de 3 cards de comment. Sin shimmer agresivo (cozytech: nada parpadea).
 */
export function CommentsSkeleton() {
  return (
    <div className="mt-3 px-3" aria-hidden="true">
      <div className="bg-border/40 h-6 w-40 animate-pulse rounded" />
      <div className="mt-6 space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <div className="bg-border/40 h-4 w-32 animate-pulse rounded" />
            <div className="bg-border/40 h-4 w-full animate-pulse rounded" />
            <div className="bg-border/40 h-4 w-3/4 animate-pulse rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}
