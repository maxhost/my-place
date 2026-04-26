import Link from 'next/link'
import type { EventDetailView } from '../domain/types'
import { EventCancelledBadge } from './event-cancelled-badge'
import { formatEventDateTime, formatTimezoneLabel } from './format-event-time'
import { RSVPButton } from './rsvp-button'
import { RsvpList } from './rsvp-list'
import { CancelEventButton } from './cancel-event-button'
import { RichTextRenderer } from '@/features/discussions/public'

/**
 * Header de metadata del evento que se renderiza arriba del thread cuando
 * un Post tiene `event` poblado (auto-thread).
 *
 * Reemplaza la antigua `EventDetail` page (F.D) — el evento ES el thread,
 * no hay URL separada (F.F). Toda la cara visible del evento (fecha,
 * timezone, location, descripción, RSVPs, acciones admin) vive arriba del
 * primer Post + comments del thread.
 *
 * Server Component. Toma el `EventDetailView` completo y compone los
 * client components (`RSVPButton`, `CancelEventButton`).
 *
 * Ver `docs/features/events/spec.md` § 11 (revisado en F.F).
 */
export function EventMetadataHeader({
  event,
  placeSlug,
  viewerUserId,
  viewerIsAdmin,
}: {
  event: EventDetailView
  placeSlug: string
  viewerUserId: string
  viewerIsAdmin: boolean
}): React.ReactNode {
  const isAuthor = event.authorUserId !== null && event.authorUserId === viewerUserId
  const isCancelled = event.state === 'cancelled'
  const isHappening = event.state === 'happening'

  return (
    <section
      aria-label="Metadata del evento"
      className="space-y-4 rounded-lg border border-place-divider bg-place-card p-4 md:p-5"
    >
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-place-text-soft">Evento</p>
            <h2 className="font-serif text-2xl text-place-text">{event.title}</h2>
          </div>
          <div className="flex items-center gap-2">
            {isCancelled ? <EventCancelledBadge /> : null}
            {isHappening ? (
              <span className="rounded bg-place-mark-bg px-2 py-0.5 text-xs text-place-mark-fg">
                Pasando ahora
              </span>
            ) : null}
          </div>
        </div>
        <div className="space-y-0.5 text-sm text-place-text-soft">
          <p>{formatEventDateTime(event.startsAt, event.endsAt, event.timezone)}</p>
          <p className="text-xs">Hora del evento — {formatTimezoneLabel(event.timezone)}</p>
          {event.location ? <p>{event.location}</p> : null}
        </div>
        <p className="text-xs text-place-text-soft">
          Propuesto por {event.authorSnapshot.displayName}
        </p>
      </header>

      {event.description ? (
        <div className="border-t border-place-divider pt-3 leading-relaxed text-place-text">
          <RichTextRenderer doc={event.description as never} placeSlug={placeSlug} />
        </div>
      ) : null}

      <div className="border-t border-place-divider pt-3">
        <RsvpList publicAttendees={event.publicAttendees} attendingCount={event.attendingCount} />
      </div>

      <div className="border-t border-place-divider pt-3">
        <RSVPButton
          eventId={event.id}
          initialState={event.viewerOwnRsvp?.state ?? null}
          initialNote={event.viewerOwnRsvp?.note ?? null}
          cancelled={isCancelled}
        />
      </div>

      {isAuthor || viewerIsAdmin ? (
        <footer className="flex flex-wrap items-center gap-3 border-t border-place-divider pt-3 text-sm">
          <Link
            href={`/events/${event.id}/edit`}
            className="rounded-md border border-place-divider px-3 py-1.5 text-place-text hover:border-place-mark-fg"
          >
            Editar evento
          </Link>
          {!isCancelled ? <CancelEventButton eventId={event.id} /> : null}
        </footer>
      ) : null}
    </section>
  )
}
