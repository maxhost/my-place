import { notFound } from 'next/navigation'
import { prisma } from '@/db/client'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import {
  CommentThread,
  DwellTracker,
  PostDetail,
  ThreadPresence,
  aggregateReactions,
  findPostBySlug,
  listCommentsByPost,
  reactionMapKey,
  resolveViewerForPlace,
  type ReactionAggregationMap,
} from '@/features/discussions/public'
import type { QuoteTargetState } from '@/features/discussions/public'

type Props = { params: Promise<{ placeSlug: string; postSlug: string }> }

/**
 * Detalle de un post: header + body + thread + composer. Admin ve posts
 * `hiddenAt` con badge; miembros comunes reciben 404 para que la ausencia sea
 * silenciosa (consistente con la lista).
 */
export default async function PostDetailPage({ params }: Props) {
  const { placeSlug, postSlug } = await params
  const place = await loadPlaceBySlug(placeSlug)
  if (!place) notFound()

  const post = await findPostBySlug(place.id, postSlug)
  if (!post) notFound()

  const viewer = await resolveViewerForPlace({ placeSlug })
  if (post.hiddenAt && !viewer.isAdmin) notFound()

  const { items: comments, nextCursor } = await listCommentsByPost({
    postId: post.id,
    includeDeleted: viewer.isAdmin,
  })

  const reactionsByKey: ReactionAggregationMap = await aggregateReactions({
    targets: [
      { type: 'POST', id: post.id },
      ...comments.map((c) => ({ type: 'COMMENT' as const, id: c.id })),
    ],
    viewerUserId: viewer.actorId,
  })

  const quoteStateByCommentId = await resolveQuoteTargetStates(comments)

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
      <DwellTracker postId={post.id} />
      <ThreadPresence
        postId={post.id}
        viewer={{
          userId: viewer.actorId,
          displayName: viewer.user.displayName,
          avatarUrl: viewer.user.avatarUrl,
        }}
      />
      <PostDetail
        post={post}
        viewerUserId={viewer.actorId}
        viewerIsAdmin={viewer.isAdmin}
        placeSlug={viewer.placeSlug}
        reactions={reactionsByKey.get(reactionMapKey('POST', post.id)) ?? []}
      />

      <CommentThread
        postId={post.id}
        placeSlug={viewer.placeSlug}
        viewerUserId={viewer.actorId}
        viewerIsAdmin={viewer.isAdmin}
        items={comments}
        nextCursor={
          nextCursor ? { createdAt: nextCursor.createdAt.toISOString(), id: nextCursor.id } : null
        }
        reactionsByKey={reactionsByKey}
        quoteStateByCommentId={quoteStateByCommentId}
      />
    </main>
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
