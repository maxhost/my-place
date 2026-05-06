import 'server-only'
import { prisma } from '@/db/client'
import { type QuoteTargetState } from '@/features/discussions/public'
import {
  CommentThread,
  PostReadersBlock,
  aggregateReactions,
  listCommentsByPost,
  listReadersByPost,
  type PostReader,
  type ReactionAggregationMap,
} from '@/features/discussions/public.server'
import { findMemberProfile } from '@/features/members/public.server'
import type { MentionResolvers } from '@/features/rich-text/public.server'

type CommentsSectionProps = {
  postId: string
  placeId: string
  placeSlug: string
  viewerUserId: string
  viewerIsAdmin: boolean
  /** ID del placeOpening actual; null si no hay opening (place cerrado). */
  placeOpeningId: string | null
}

/**
 * Streamed section para la item-detail page de biblioteca: comments +
 * reactions (POST + comments en una sola call) + readers + quote state.
 * Vive bajo `<Suspense>` en el page para que el shell del item (header
 * sticky + body + ReactionBar del POST) pinte primero.
 *
 * Combinamos `aggregateReactions` POST+comments en una sola call (mismo
 * patrón que `/conversations/[postSlug]`). Antes había 2 calls separadas
 * (1 para el POST, otra para los comments después de la lista) — ahora
 * es una sola, ahorrando 1 round-trip. El page sigue haciendo una
 * agregación acotada al POST para pintar la bar del shell antes de que
 * estremee la lista — es 1 query duplicada del POST a cambio de tiempo
 * percibido más bajo.
 *
 * El sufijo `_` excluye al archivo del file-system routing de Next.
 */
export async function CommentsSection({
  postId,
  placeId,
  placeSlug,
  viewerUserId,
  viewerIsAdmin,
  placeOpeningId,
}: CommentsSectionProps) {
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
  // dependen de los comment ids.
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
 * Resolvers de mention para el `RichTextRenderer` SSR. F.3 cubre `user`;
 * `event` / `libraryItem` retornan `null` (el renderer pinta los placeholders
 * `[EVENTO NO DISPONIBLE]` / `[RECURSO NO DISPONIBLE]`) hasta F.4.
 */
function buildMentionResolvers({ placeId }: { placeId: string }): MentionResolvers {
  return {
    user: async (userId) => {
      const profile = await findMemberProfile(placeId, userId)
      if (!profile) return null
      return { label: profile.user.displayName, href: `/m/${userId}` }
    },
    event: async () => null,
    libraryItem: async () => null,
  }
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
