import type { DayOfWeek, OpeningHours, RecurringWindow } from '../domain/types'
import { DAY_ORDER } from '../domain/types'

/**
 * Resumen humano en español del `OpeningHours`. Se usa desde el form como
 * preview live y desde `<PlaceClosedView>` para mostrarle al miembro cuándo
 * abre. Server Component puro (sin estado, sin handlers) — se lo puede pasar
 * por `children` a un Client Component si hace falta.
 */

const DAY_ES: Record<DayOfWeek, string> = {
  MON: 'lunes',
  TUE: 'martes',
  WED: 'miércoles',
  THU: 'jueves',
  FRI: 'viernes',
  SAT: 'sábado',
  SUN: 'domingo',
}

export function HoursPreview({ hours }: { hours: OpeningHours }) {
  if (hours.kind === 'unconfigured') {
    return <p className="text-sm italic text-neutral-500">Horario aún no configurado.</p>
  }

  if (hours.kind === 'always_open') {
    return (
      <p className="text-sm text-neutral-700">Abierto 24/7 ({humanTimezone(hours.timezone)}).</p>
    )
  }

  const byDay = groupByDay(hours.recurring)
  const hasAny = hours.recurring.length > 0 || hours.exceptions.length > 0

  return (
    <div className="space-y-3 text-sm text-neutral-700">
      <p className="text-xs text-neutral-500">Horario en {humanTimezone(hours.timezone)}.</p>

      {hours.recurring.length === 0 ? (
        <p className="italic text-neutral-500">Sin ventanas recurrentes.</p>
      ) : (
        <ul className="space-y-1">
          {DAY_ORDER.filter((d) => byDay.has(d)).map((day) => (
            <li key={day} className="flex gap-3">
              <span className="w-24 capitalize text-neutral-500">{DAY_ES[day]}</span>
              <span>
                {byDay
                  .get(day)!
                  .map((w) => `${w.start}–${w.end}`)
                  .join(', ')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {hours.exceptions.length > 0 ? (
        <div className="space-y-1 border-t border-neutral-200 pt-3">
          <p className="text-xs text-neutral-500">Excepciones</p>
          <ul className="space-y-1">
            {hours.exceptions.map((ex) => (
              <li key={ex.date} className="flex gap-3">
                <span className="w-24 text-neutral-500">{ex.date}</span>
                <span>
                  {'closed' in ex
                    ? 'cerrado'
                    : ex.windows.map((w) => `${w.start}–${w.end}`).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!hasAny ? (
        <p className="italic text-neutral-500">Place cerrado hasta configurar ventanas.</p>
      ) : null}
    </div>
  )
}

function groupByDay(recurring: RecurringWindow[]): Map<DayOfWeek, RecurringWindow[]> {
  const map = new Map<DayOfWeek, RecurringWindow[]>()
  for (const w of recurring) {
    const list = map.get(w.day) ?? []
    list.push(w)
    map.set(w.day, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.start.localeCompare(b.start))
  }
  return map
}

export function humanTimezone(tz: string): string {
  // `America/Argentina/Buenos_Aires` → "Buenos Aires"
  // `Europe/Madrid` → "Madrid"
  // `UTC` → "UTC"
  if (tz === 'UTC') return 'UTC'
  const parts = tz.split('/')
  const last = parts.at(-1) ?? tz
  return last.replace(/_/g, ' ')
}
