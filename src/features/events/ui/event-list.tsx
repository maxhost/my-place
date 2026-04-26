import type { EventListView } from '../domain/types'
import { EventListItem } from './event-list-item'
import { BentoGrid } from '@/shared/ui/bento'
import { SectionHead } from '@/shared/ui/section-head'

/**
 * Lista de eventos del place. Divide en dos secciones:
 *  - **Próximos** (upcoming + happening): bento grid 2-col con primer
 *    evento `hero` (col-span-2). ASC por startsAt.
 *  - **Pasados** (past): collapsed bajo `<details>`, lista lineal sin
 *    hero. DESC por startsAt.
 *
 * Cancelados se conservan en su sección original con badge.
 *
 * Sin scroll infinito. F1 sin paginación; cuando supere 20 events se agrega
 * cursor (mismo patrón discussions).
 */
export function EventList({ events }: { events: EventListView[] }): React.ReactNode {
  if (events.length === 0) {
    return (
      <div className="rounded-card border-[0.5px] border-border bg-surface p-6 text-center text-sm text-muted">
        Todavía no hay eventos. Proponé el primero.
      </div>
    )
  }

  const upcoming = events.filter((e) => e.state === 'upcoming' || e.state === 'happening')
  // El query devuelve startsAt ASC; en pasados queremos DESC.
  const past = events.filter((e) => e.state === 'past' || e.state === 'cancelled').reverse()

  return (
    <div className="space-y-6">
      {upcoming.length > 0 ? (
        <section aria-label="Próximos eventos" className="space-y-3.5">
          <SectionHead meta="Próximos" emoji="📅" />
          <BentoGrid>
            {upcoming.map((event, idx) => (
              <EventListItem key={event.id} event={event} hero={idx === 0} />
            ))}
          </BentoGrid>
        </section>
      ) : (
        <p className="text-sm text-muted">No hay eventos próximos.</p>
      )}

      {past.length > 0 ? (
        <details className="group rounded-card border-[0.5px] border-border bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm text-muted hover:text-text">
            <span className="font-medium">Pasados ({past.length})</span>
            <span className="ml-2 text-xs italic group-open:hidden">— mostrar</span>
            <span className="ml-2 hidden text-xs italic group-open:inline">— ocultar</span>
          </summary>
          <div className="space-y-3 border-t-[0.5px] border-border p-3">
            {past.map((event) => (
              <EventListItem key={event.id} event={event} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}
