import { notFound } from 'next/navigation'
import { prisma } from '@/db/client'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { logger } from '@/shared/lib/logger'
import {
  CommentThread,
  DwellTracker,
  PostAdminMenu,
  PostDetail,
  PostReadersBlock,
  ReactionBar,
  ThreadHeaderBar,
  ThreadPresence,
  aggregateReactions,
  findOrCreateCurrentOpening,
  findPostBySlug,
  listCommentsByPost,
  listReadersByPost,
  reactionMapKey,
  resolveViewerForPlace,
  type PostReader,
  type ReactionAggregationMap,
} from '@/features/discussions/public'
import type { QuoteTargetState } from '@/features/discussions/public'
import { EventActionsMenu, EventMetadataHeader } from '@/features/events/public'
import { getEvent } from '@/features/events/public.server'

type Props = { params: Promise<{ placeSlug: string; postSlug: string }> }

/**
 * Detalle de un post (R.6.4 layout): ThreadHeaderBar sticky + PostDetail
 * + readers + thread + composer fixed bottom. Admin ve posts `hiddenAt`
 * con badge; miembros comunes reciben 404 para que la ausencia sea
 * silenciosa (consistente con la lista).
 *
 * Layout chrome top: AppShell TopBar (52px, no sticky) + dots (28px, no
 * sticky) + ThreadHeaderBar (56px, sticky). Cuando el user scrollea, los
 * dos primeros se van con el body, el ThreadHeaderBar queda pinned arriba.
 *
 * `pb-32` reserva espacio para el `<CommentComposer>` que vive `fixed
 * bottom-0` — sin este padding el último comment quedaría tapado.
 */
export default async function PostDetailPage({ params }: Props) {
  const { placeSlug, postSlug } = await params
  const place = await loadPlaceBySlug(placeSlug)
  if (!place) notFound()

  // Paralelizamos lo que no tiene dependencia entre sí. `resolveViewerForPlace`
  // internamente comparte el cache de `loadPlaceBySlug` (React.cache) — no
  // duplica queries (ver discussions/server/actor.ts:48-93).
  // `findOrCreateCurrentOpening` también va acá porque solo depende de
  // place.id; está cached por request, así que no se duplica con el
  // fire-and-forget del (gated)/layout. El catch convierte el error a null
  // para preservar el comportamiento "sin opening → sin readers" como hoy.
  const [post, viewer, opening] = await Promise.all([
    findPostBySlug(place.id, postSlug),
    resolveViewerForPlace({ placeSlug }),
    findOrCreateCurrentOpening(place.id).catch((err: unknown) => {
      logger.error({ err, placeId: place.id }, 'failed to materialize opening')
      return null
    }),
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

  // Group 3: reactions + quoteState + readers. `listReadersByPost` depende
  // de post.id y opening.id, ambos ya disponibles. Si no hay opening,
  // pasamos array vacío (el componente devuelve null en ese caso).
  const [reactionsByKey, quoteStateByCommentId, readers] = await Promise.all([
    aggregateReactions({
      targets: [
        { type: 'POST', id: post.id },
        ...comments.map((c) => ({ type: 'COMMENT' as const, id: c.id })),
      ],
      viewerUserId: viewer.actorId,
    }) as Promise<ReactionAggregationMap>,
    resolveQuoteTargetStates(comments),
    opening
      ? listReadersByPost({
          postId: post.id,
          placeId: place.id,
          placeOpeningId: opening.id,
          excludeUserId: viewer.actorId,
        })
      : Promise.resolve([] as PostReader[]),
  ])

  // Resolver el rightSlot del ThreadHeaderBar:
  //  - Event-thread (post.event poblado) + author/admin del evento →
  //    <EventActionsMenu> (Editar evento + Cancelar evento). Reemplaza
  //    el footer de <EventMetadataHeader> que tenía estos 2 buttons.
  //  - Post normal + admin → <PostAdminMenu> (Editar/Ocultar/Eliminar).
  //  - Otros casos → null (sin kebab).
  const isEventAuthor =
    eventDetail?.authorUserId !== null && eventDetail?.authorUserId === viewer.actorId
  const showEventMenu = eventDetail !== null && (isEventAuthor || viewer.isAdmin)
  const headerRightSlot = showEventMenu ? (
    <EventActionsMenu eventId={eventDetail.id} cancelled={eventDetail.state === 'cancelled'} />
  ) : viewer.isAdmin ? (
    <PostAdminMenu postId={post.id} hiddenAt={post.hiddenAt} expectedVersion={post.version} />
  ) : null

  return (
    <div className="pb-32">
      <ThreadHeaderBar rightSlot={headerRightSlot} />

      <DwellTracker postId={post.id} />
      <ThreadPresence
        postId={post.id}
        viewer={{
          userId: viewer.actorId,
          displayName: viewer.user.displayName,
          avatarUrl: viewer.user.avatarUrl,
        }}
      />

      {eventDetail ? (
        // F.H.1 (2026-04-27): event-thread renderiza
        // EventMetadataHeader (con OrganizerRow al final) + separator
        // + ReactionBar standalone + readers + thread. SIN PostDetail
        // (su título auto "Conversación: X" y body genérico eran
        // redundantes con el evento).
        <>
          <EventMetadataHeader event={eventDetail} placeSlug={viewer.placeSlug} />
          <div className="mx-3 mt-6 border-t-[0.5px] border-border" />
          <div className="px-3 pt-4">
            <ReactionBar
              targetType="POST"
              targetId={post.id}
              initial={reactionsByKey.get(reactionMapKey('POST', post.id)) ?? []}
            />
          </div>
        </>
      ) : (
        <PostDetail
          post={post}
          viewerUserId={viewer.actorId}
          placeSlug={viewer.placeSlug}
          reactions={reactionsByKey.get(reactionMapKey('POST', post.id)) ?? []}
        />
      )}

      <div className="mt-3">
        <PostReadersBlock readers={readers} />
      </div>

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
    </div>
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
