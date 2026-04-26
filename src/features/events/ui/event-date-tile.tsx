import { formatEventDateParts } from './format-event-time'

/**
 * Calendar-tile compacto para el event metadata header. 56×60, fondo soft,
 * radius 10. Render: month uppercase accent + day grande serif + dow
 * uppercase muted.
 *
 * Server-renderizable. El timezone se toma del evento (siempre la "hora del
 * evento", no la del viewer — alineado con `format-event-time.ts`).
 */
type EventDateTileProps = {
  date: Date
  timezone: string
  className?: string
}

export function EventDateTile({ date, timezone, className }: EventDateTileProps): React.ReactNode {
  const { dow, day, month } = formatEventDateParts(date, timezone)
  return (
    <div
      className={[
        'flex h-[60px] w-14 shrink-0 flex-col items-center justify-center rounded-[10px] bg-soft',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={`${dow} ${day} ${month}`}
    >
      <div className="font-body text-[10px] font-bold tracking-wider text-accent">{month}</div>
      <div className="mt-0.5 font-title text-[22px] font-semibold leading-none text-text">
        {day}
      </div>
      <div className="mt-0.5 font-body text-[9px] font-semibold tracking-wider text-muted">
        {dow}
      </div>
    </div>
  )
}
