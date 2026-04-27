import { MapPin } from 'lucide-react'
import type { EventDetailView } from '../domain/types'
import { EventCancelledBadge } from './event-cancelled-badge'
import { formatEventTimeRange, formatTimezoneLabel } from './format-event-time'
import { RSVPButton } from './rsvp-button'
import { EventDateTile } from './event-date-tile'
import { AttendeeAvatars } from './attendee-avatars'
import { OverlineTag } from '@/shared/ui/overline-tag'
import { RichTextRenderer } from '@/features/discussions/public'

/**
 * Header de metadata del evento que se renderiza arriba del thread cuando
 * un Post tiene `event` poblado (auto-thread).
 *
 * Reemplaza la antigua `EventDetail` page (F.D) — el evento ES el thread,
 * no hay URL separada (F.F). Aplica el design del handoff F.G:
 * OverlineTag "🎉 EVENTO", título serif grande, event card (calendar tile +
 * info + attendees + RSVP), descripción serif, footer admin/author.
 *

 * Server Component. Toma el `EventDetailView` completo y compone el
 * client component `<RSVPButton>`. Las acciones admin/author del
 * evento (Editar evento, Cancelar evento) viven ahora en el kebab
 * del `<ThreadHeaderBar>` via `<EventActionsMenu>` — montado por la
 * page composer. Footer interno removido 2026-04-27.
 *
 * Ver `docs/features/events/spec.md` § 11 (revisado en F.F + F.G).
 */
export function EventMetadataHeader({
  event,
  placeSlug,
}: {
  event: EventDetailView
  placeSlug: string
}): React.ReactNode {
  const isCancelled = event.state === 'cancelled'
  const isHappening = event.state === 'happening'
  const timeRange = formatEventTimeRange(event.startsAt, event.endsAt, event.timezone)

  return (
    <section aria-label="Metadata del evento" className="space-y-[18px] px-3 pt-4">
      <div>
        <OverlineTag emoji="🎉">Evento</OverlineTag>
        <h2 className="mt-1.5 font-title text-[28px] font-semibold leading-[1.15] tracking-tight text-text">
          {event.title}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {isCancelled ? <EventCancelledBadge /> : null}
          {isHappening ? <span className="italic text-text">Pasando ahora</span> : null}
        </div>
      </div>

      <div className="rounded-[14px] border-[0.5px] border-border bg-surface p-3.5">
        {/* Row 1 — calendar tile + info */}
        <div className="flex items-center gap-3.5">
          <EventDateTile date={event.startsAt} timezone={event.timezone} />
          <div className="min-w-0 flex-1">
            <div className="font-body text-sm font-semibold text-text">{timeRange}</div>
            <div className="mt-0.5 font-body text-[11px] text-muted">
              Hora del evento — {formatTimezoneLabel(event.timezone)}
            </div>
            {event.location ? (
              <div className="mt-1 flex items-center gap-1 font-body text-[13px] text-muted">
                <MapPin size={13} aria-hidden="true" />
                <span className="truncate">{event.location}</span>
              </div>
            ) : null}
            <div className="mt-1 font-body text-xs text-muted">
              Organiza{' '}
              <span className="font-medium text-text">{event.authorSnapshot.displayName}</span>
            </div>
          </div>
        </div>

        {/* Row 2 — attendees + count */}
        {event.attendingCount > 0 || event.publicAttendees.length > 0 ? (
          <div className="mt-3.5 flex items-center gap-2 border-t-[0.5px] border-border pt-3">
            <AttendeeAvatars attendees={event.publicAttendees} />
            <span className="font-body text-[13px] text-muted">van {event.attendingCount}</span>
          </div>
        ) : null}

        {/* Row 3 — RSVP */}
        <div className="mt-3 border-t-[0.5px] border-border pt-3">
          <RSVPButton
            eventId={event.id}
            initialState={event.viewerOwnRsvp?.state ?? null}
            initialNote={event.viewerOwnRsvp?.note ?? null}
            cancelled={isCancelled}
          />
        </div>
      </div>

      {event.description ? (
        <div className="font-title text-[17px] leading-[1.55] tracking-tight text-text">
          <RichTextRenderer doc={event.description as never} placeSlug={placeSlug} />
        </div>
      ) : null}

      {/* Footer con "Editar evento" + "Cancelar evento" REMOVIDO 2026-04-27 —
          esas acciones ahora viven en el kebab del <ThreadHeaderBar> via
          <EventActionsMenu>. La page composer del thread monta el menú
          cuando viewer es author o admin del evento. Centralizar las
          acciones en un solo lugar visual reduce ruido y unifica el
          patrón con <PostAdminMenu>. */}
    </section>
  )
}
