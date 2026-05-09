import { notFound, redirect } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { resolveViewerForPlace } from '@/features/discussions/public.server'
import { findEventForRedirect } from '@/features/events/public.server'

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
 * Sesión 4 (perf): la query `getEvent(...)` original cargaba RSVPs y
 * counts que se descartaban inmediatamente; reemplazada por
 * `findEventForRedirect(...)` minimal que devuelve sólo `{ postSlug }`.
 * Ahorra ~70ms del path crítico del redirect.
 *
 * Si el evento no existe (o existió pero el `post` asociado se borró —
 * caso defensivo: race con discussions hard-delete) → 404. Si el viewer
 * no es miembro activo del place → `AuthorizationError`.
 *
 * Ver `docs/decisions/2026-04-26-events-as-thread-unified-url.md`.
 */
export default async function EventLegacyDetailPage({ params }: Props) {
  const { placeSlug, eventId } = await params
  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) notFound()

  // Preservamos el gate explícito de membership (además del que aplica
  // `(gated)/layout.tsx`): si el viewer no es miembro activo, este resolver
  // tira `AuthorizationError` antes de cualquier query al evento.
  await resolveViewerForPlace({ placeSlug })

  const event = await findEventForRedirect(eventId, place.id)
  if (!event) notFound()

  // `?from=events` para que el back button del thread destino vuelva al
  // listado `/events`. Quien hit `/events/[id]` venía conceptualmente
  // desde la zona Eventos (o desde un link viejo apuntando ahí). Ver
  // `docs/decisions/2026-05-09-back-navigation-origin.md`.
  redirect(`/conversations/${event.postSlug}?from=events`)
}
