import Link from 'next/link'
import type { EventListView } from '../domain/types'
import { EventCancelledBadge } from './event-cancelled-badge'
import { formatEventDateTime } from './format-event-time'
import { rsvpLabel } from './rsvp-labels'

/**
 * Card de evento en el listado. Linkea al **thread del evento**
 * (`/conversations/[postSlug]`) — el evento ES el thread (F.F).
 *
 * Si el evento no tiene `postSlug` (caso defensivo: race entre create del
 * Event y del Post asociado, o discussions deshabilitado), la card es
 * no-clickeable.
 *
 * Estado derivado se usa para atenuar visualmente eventos pasados
 * (consistente con `isDormant` de discussions) — sin grito, sin badge
 * "PASÓ" ruidoso. Cancelados muestran badge dedicado.
 */
export function EventListItem({ event }: { event: EventListView }): React.ReactNode {
  const isPast = event.state === 'past'
  const isCancelled = event.state === 'cancelled'
  const isHappening = event.state === 'happening'

  const cardClasses = `rounded-lg border border-place-divider bg-place-card p-4 transition ${
    isPast || isCancelled ? 'opacity-75' : ''
  }`

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h3
          className={`font-serif text-xl ${
            isPast || isCancelled ? 'text-place-text-medium' : 'text-place-text'
          }`}
        >
          {event.title}
        </h3>
        {isCancelled ? <EventCancelledBadge /> : null}
      </div>
      <p className="mt-1 text-sm text-place-text-soft">
        {formatEventDateTime(event.startsAt, event.endsAt, event.timezone)}
      </p>
      {event.location ? (
        <p className="mt-0.5 text-xs text-place-text-soft">{event.location}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-place-text-soft">
        <span>{event.authorSnapshot.displayName}</span>
        {isHappening ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="italic text-place-text">Pasando ahora</span>
          </>
        ) : null}
        {event.attendingCount > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span>
              {event.attendingCount} {event.attendingCount === 1 ? 'confirmado' : 'confirmados'}
            </span>
          </>
        ) : null}
        {event.viewerRsvpState ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="italic">Tu respuesta: {rsvpLabel(event.viewerRsvpState)}</span>
          </>
        ) : null}
      </div>
    </>
  )

  if (event.postSlug) {
    return (
      <article className={cardClasses}>
        <Link
          href={`/conversations/${event.postSlug}`}
          className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-place-mark-fg"
        >
          {inner}
        </Link>
      </article>
    )
  }

  return <article className={cardClasses}>{inner}</article>
}
