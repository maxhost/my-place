import Link from 'next/link'
import type { OpeningHours } from '../domain/types'
import { HoursPreview, humanTimezone } from './hours-preview'

/**
 * Pantalla que reemplaza al contenido del place cuando está cerrado. Respeta el
 * tema del place (`bg-place`, `text-place-text` — CSS vars ya inyectadas por
 * `[placeSlug]/layout.tsx`), no usa clases de color hardcoded.
 *
 * Dos variantes:
 *  - `member`: mensaje simple con el próximo `opensAt` (o "horario no configurado").
 *  - `admin`: mismo mensaje + CTA discreto "Ir a configuración" que lleva a
 *    `/settings/hours` (la única ruta accesible con el place cerrado).
 *
 * Server Component puro — no necesita JS en el cliente.
 */

type Props = {
  placeName: string
  placeSlug: string
  opensAt: Date | null
  hours: OpeningHours
  variant: 'admin' | 'member'
}

export function PlaceClosedView({ placeName, placeSlug, opensAt, hours, variant }: Props) {
  const timezone = hours.kind === 'scheduled' ? hours.timezone : undefined

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-6 p-8 text-center">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-place-text-soft">{placeName}</p>
        <h1 className="font-serif text-4xl italic">Está cerrado</h1>
      </header>

      <OpensAtLine opensAt={opensAt} timezone={timezone} />

      <section className="w-full rounded-md border border-place-divider bg-place-card-soft p-4 text-left">
        <p className="mb-2 text-xs uppercase tracking-wide text-place-text-soft">Horario</p>
        <HoursPreview hours={hours} />
      </section>

      {variant === 'admin' ? (
        <Link
          href={`/${placeSlug}/settings/hours`}
          className="rounded-md border border-place-divider px-4 py-2 text-sm text-place-text hover:border-place-text"
        >
          Ir a configuración
        </Link>
      ) : (
        <p className="text-xs text-place-text-soft">
          Si necesitás acceso antes, contactá al admin del place.
        </p>
      )}
    </main>
  )
}

function OpensAtLine({
  opensAt,
  timezone,
}: {
  opensAt: Date | null
  timezone: string | undefined
}) {
  if (!opensAt) {
    return <p className="text-place-text-soft">Horario aún no configurado.</p>
  }
  if (!timezone) {
    return <p className="text-place-text-soft">Abrimos pronto.</p>
  }
  const label = formatOpensAt(opensAt, timezone)
  return (
    <p className="text-place-text-soft">
      Abrimos {label} ({humanTimezone(timezone)}).
    </p>
  )
}

const DAY_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/**
 * Formatea "jueves 7 de mayo a las 19:00" en la timezone del place, en español.
 * `Intl.DateTimeFormat` con `hourCycle: 'h23'` y `timeZone: tz` evita problemas
 * de DST al renderizar horas ambiguas.
 */
function formatOpensAt(opensAt: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('es-AR', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(opensAt)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value
      return acc
    }, {})

  const weekday = parts.weekday ?? DAY_ES[opensAt.getUTCDay()] ?? ''
  const day = parts.day ?? ''
  const month = parts.month ?? ''
  const hour = parts.hour ?? ''
  const minute = parts.minute ?? ''
  return `${weekday} ${day} de ${month} a las ${hour}:${minute}`
}
