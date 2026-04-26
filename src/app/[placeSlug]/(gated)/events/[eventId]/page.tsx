import { notFound, redirect } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { resolveViewerForPlace } from '@/features/discussions/public.server'
import { getEvent } from '@/features/events/public.server'

type Props = { params: Promise<{ placeSlug: string; eventId: string }> }

/**
 * Backward-compat redirect: F.F unificó la cara visible del evento con su
 * thread asociado. La URL canónica ahora es `/conversations/${postSlug}`
 * (el evento ES el thread). Las URLs viejas `/events/${eventId}` se
 * mantienen como redirects 308 server-side para no romper:
 *  - links externos compartidos.
 *  - bookmarks.
 *  - links autogenerados por consumidores anteriores al refactor.
 *
 * Si el evento no existe o el viewer no tiene visibilidad → 404 normal.
 * Si el evento existe pero no tiene Post asociado (caso defensivo: race
 * o discussions deshabilitado) → redirect al listado `/events`.
 *
 * Ver `docs/decisions/2026-04-26-events-as-thread-unified-url.md`.
 */
export default async function EventLegacyDetailPage({ params }: Props) {
  const { placeSlug, eventId } = await params
  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) notFound()

  const viewer = await resolveViewerForPlace({ placeSlug })
  const event = await getEvent({
    eventId,
    placeId: place.id,
    viewerUserId: viewer.actorId,
  })
  if (!event) notFound()

  if (event.postSlug) {
    redirect(`/conversations/${event.postSlug}`)
  }

  // Defensivo: evento sin Post asociado (no debería pasar en F1, pero el
  // schema lo permite). Mandamos al listado para evitar quedar varado.
  redirect('/events')
}
