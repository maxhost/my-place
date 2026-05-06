import { Suspense } from 'react'
import { notFound, permanentRedirect } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { logger } from '@/shared/lib/logger'
import {
  DwellTracker,
  PostAdminMenu,
  ReactionBar,
  ThreadHeaderBar,
  ThreadPresence,
} from '@/features/discussions/public'
import {
  PostDetail,
  aggregateReactions,
  findOrCreateCurrentOpening,
  findPostBySlug,
  reactionMapKey,
  resolveViewerForPlace,
  type ReactionAggregationMap,
} from '@/features/discussions/public.server'
import { EventActionsMenu, EventMetadataHeader } from '@/features/events/public'
import { getEvent } from '@/features/events/public.server'
import { CommentsSection, CommentsSkeleton } from './_comments-section'
import { buildMentionResolvers } from './_mention-resolvers'

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
 *
 * Streaming: el shell (header + PostDetail / EventMetadataHeader +
 * ReactionBar del POST) pinta primero. Comments + readers + quoteState
 * viven bajo `<Suspense>` en `<CommentsSection>` (sibling
 * `_comments-section.tsx`) — esas queries son las más pesadas.
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

  // R.7.9: cross-zona redirect. Si el Post es un thread documento de
  // biblioteca, la URL canónica vive bajo /library/[cat]/[slug]. Esto
  // preserva enlaces externos a /conversations/[slug] (autocompleto del
  // search overlay R.4 podría apuntar acá) — `permanentRedirect` (308)
  // refleja que la canónica es estable. Asimétrico con eventos por
  // diseño (spec § 13.1: items pertenecen a una sub-zona, eventos no).
  if (post.libraryItem) {
    permanentRedirect(`/library/${post.libraryItem.categorySlug}/${post.slug}`)
  }

  // F.F: el evento ES el thread. Si el Post fue auto-creado por un evento
  // (`post.event` poblado en `findPostBySlug`), levantamos el detalle
  // completo del evento y renderizamos `EventMetadataHeader` arriba del
  // PostDetail. Sin event poblado, la page se comporta como antes (Post
  // standalone). El detail del evento es shell-crítico (header del thread
  // muestra título/fecha/lugar), así que NO va dentro del Suspense.
  //
  // Reactions del POST: solo necesitamos las del propio post para pintar
  // la `<ReactionBar>` del shell (PostDetail o EventMetadataHeader). Las
  // de los comments se agregan dentro de `<CommentsSection>` junto con
  // las del POST en una sola call combinada — esto causa una pequeña
  // duplicación (1 fetch del POST acá + 1 batch combinado en el suspense)
  // a cambio de que la bar del POST pinte sin esperar el listado.
  const [eventDetail, postReactions] = await Promise.all([
    post.event
      ? getEvent({
          eventId: post.event.id,
          placeId: place.id,
          viewerUserId: viewer.actorId,
        })
      : Promise.resolve(null),
    aggregateReactions({
      targets: [{ type: 'POST', id: post.id }],
      viewerUserId: viewer.actorId,
    }) as Promise<ReactionAggregationMap>,
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
              initial={postReactions.get(reactionMapKey('POST', post.id)) ?? []}
            />
          </div>
        </>
      ) : (
        <PostDetail
          post={post}
          viewerUserId={viewer.actorId}
          placeSlug={viewer.placeSlug}
          reactions={postReactions.get(reactionMapKey('POST', post.id)) ?? []}
          mentionResolvers={buildMentionResolvers({ placeId: place.id })}
        />
      )}

      <Suspense fallback={<CommentsSkeleton />}>
        <CommentsSection
          postId={post.id}
          placeId={place.id}
          placeSlug={viewer.placeSlug}
          viewerUserId={viewer.actorId}
          viewerIsAdmin={viewer.isAdmin}
          placeOpeningId={opening?.id ?? null}
        />
      </Suspense>
    </div>
  )
}
