import Link from 'next/link'
import type { EventListView } from '../domain/types'
import { EventCancelledBadge } from './event-cancelled-badge'
import { formatEventCompactDate, formatEventTimeRange } from './format-event-time'
import { rsvpLabel } from './rsvp-labels'
import { BentoCard } from '@/shared/ui/bento'
import { OverlineTag } from '@/shared/ui/overline-tag'

/**
 * Card de evento en el listado bento. Linkea al **thread del evento**
 * (`/conversations/[postSlug]`) — el evento ES el thread (F.F).
 *
 * Layout:
 *  - `hero` (primer evento upcoming): col-span-2, padding 16, emoji 4xl,
 *    título 20, subtítulo con location + "van N".
 *  - default: 1 col, padding 14, emoji 26, título 14.
 *
 * Sin emoji por evento en el dominio actual; usamos `📅` como default. El
 * schema puede extenderse si producto decide habilitar custom emojis por
 * evento (out of scope F.G).
 *
 * Si el evento no tiene `postSlug` (caso defensivo: race entre create del
 * Event y del Post asociado, o discussions deshabilitado), la card es
 * no-clickeable.
 */
export function EventListItem({
  event,
  hero = false,
}: {
  event: EventListView
  hero?: boolean
}): React.ReactNode {
  const isPast = event.state === 'past'
  const isCancelled = event.state === 'cancelled'
  const isHappening = event.state === 'happening'

  const compactDate = formatEventCompactDate(event.startsAt, event.timezone)
  const timeRange = formatEventTimeRange(event.startsAt, event.endsAt, event.timezone)

  const subtitle = buildSubtitle({
    location: event.location,
    authorName: event.authorSnapshot.displayName,
    attendingCount: hero ? event.attendingCount : 0,
  })

  const dimmed = isPast || isCancelled

  const inner = (
    <div className={dimmed ? 'opacity-75' : ''}>
      <div
        aria-hidden="true"
        className={hero ? 'mb-3 text-4xl leading-none' : 'mb-2.5 text-[26px] leading-none'}
      >
        📅
      </div>
      <OverlineTag className={hero ? 'text-xs' : 'text-[11px]'}>
        {compactDate} · {timeRange}
      </OverlineTag>
      <h3
        className={[
          'mt-1 font-body font-bold leading-tight text-text',
          hero ? 'text-xl tracking-tight' : 'text-sm tracking-tight',
        ].join(' ')}
      >
        {event.title}
      </h3>
      {subtitle ? (
        <p
          className={[
            'mt-1 font-body leading-snug text-muted',
            hero ? 'text-[13px]' : 'text-xs',
          ].join(' ')}
        >
          {subtitle}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {isCancelled ? <EventCancelledBadge /> : null}
        {isHappening ? <span className="italic text-text">Pasando ahora</span> : null}
        {event.viewerRsvpState ? (
          <span className="text-muted">Tu respuesta: {rsvpLabel(event.viewerRsvpState)}</span>
        ) : null}
      </div>
    </div>
  )

  if (event.postSlug) {
    return (
      <BentoCard hero={hero} as={Link} href={`/conversations/${event.postSlug}`}>
        {inner}
      </BentoCard>
    )
  }

  return <BentoCard hero={hero}>{inner}</BentoCard>
}

function buildSubtitle({
  location,
  authorName,
  attendingCount,
}: {
  location: string | null
  authorName: string
  attendingCount: number
}): string | null {
  // "van N" sin bold, alineado con principio "sin métricas vanidosas".
  const base = location ?? authorName
  if (attendingCount > 0) return `${base} · van ${attendingCount}`
  return base || null
}
