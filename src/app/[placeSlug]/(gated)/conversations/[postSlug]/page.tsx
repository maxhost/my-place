import { notFound } from 'next/navigation'
import { prisma } from '@/db/client'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import {
  CommentThread,
  DwellTracker,
  PostDetail,
  PostReadersBlock,
  ThreadPresence,
  aggregateReactions,
  findPostBySlug,
  listCommentsByPost,
  reactionMapKey,
  resolveViewerForPlace,
  type ReactionAggregationMap,
} from '@/features/discussions/public'
import type { QuoteTargetState } from '@/features/discussions/public'
import { EventMetadataHeader } from '@/features/events/public'
import { getEvent } from '@/features/events/public.server'

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

  // Paralelizamos lo que no tiene dependencia entre sí. `resolveViewerForPlace`
  // internamente comparte el cache de `loadPlaceBySlug` (React.cache) — no
  // duplica queries (ver discussions/server/actor.ts:48-93).
  const [post, viewer] = await Promise.all([
    findPostBySlug(place.id, postSlug),
    resolveViewerForPlace({ placeSlug }),
  ])
  if (!post) notFound()
  if (post.hiddenAt && !viewer.isAdmin) notFound()

  // F.F: el evento ES el thread. Si el Post fue auto-creado por un evento
  // (`post.event` poblado en `findPostBySlug`), levantamos el detalle
  // completo del evento y renderizamos `EventMetadataHeader` arriba del
  // PostDetail. Sin event poblado, la page se comporta como antes (Post
  // standalone).
  const [{ items: comments, nextCursor }, eventDetail] = await Promise.all([
    listCommentsByPost({
      postId: post.id,
      includeDeleted: viewer.isAdmin,
    }),
    post.event
      ? getEvent({
          eventId: post.event.id,
          placeId: place.id,
          viewerUserId: viewer.actorId,
        })
      : Promise.resolve(null),
  ])

  const [reactionsByKey, quoteStateByCommentId] = await Promise.all([
    aggregateReactions({
      targets: [
        { type: 'POST', id: post.id },
        ...comments.map((c) => ({ type: 'COMMENT' as const, id: c.id })),
      ],
      viewerUserId: viewer.actorId,
    }) as Promise<ReactionAggregationMap>,
    resolveQuoteTargetStates(comments),
  ])

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
      <PostReadersBlock
        postId={post.id}
        placeId={viewer.placeId}
        placeSlug={viewer.placeSlug}
        viewerUserId={viewer.actorId}
      />
      {eventDetail ? (
        <EventMetadataHeader
          event={eventDetail}
          placeSlug={viewer.placeSlug}
          viewerUserId={viewer.actorId}
          viewerIsAdmin={viewer.isAdmin}
        />
      ) : null}
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
