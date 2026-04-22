import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import {
  ALLOWED_TIMEZONES,
  HoursForm,
  HoursPreview,
  parseOpeningHours,
  type HoursFormDefaults,
  type OpeningHours,
} from '@/features/hours/public'

export const metadata: Metadata = {
  title: 'Horario · Settings',
}

type Props = { params: Promise<{ placeSlug: string }> }

/**
 * Config del horario del place. El gate admin/owner lo hace `settings/layout.tsx`;
 * esta página solo carga el estado actual y renderiza el form.
 *
 * Ver `docs/features/hours/spec.md` § "Flows principales".
 */
export default async function SettingsHoursPage({ params }: Props) {
  const { placeSlug } = await params

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) {
    notFound()
  }

  const hours = parseOpeningHours(place.openingHours)
  const defaults = hoursToFormDefaults(hours)

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <header>
        <p className="text-sm text-neutral-500">Settings · {place.name}</p>
        <h1 className="font-serif text-3xl italic">Horario</h1>
        <p className="mt-1 text-xs text-neutral-400">
          Un place nace cerrado; configurá ventanas para que los miembros puedan entrar.
        </p>
      </header>

      <section className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
        <p className="mb-2 text-xs uppercase tracking-wide text-neutral-500">Estado actual</p>
        <HoursPreview hours={hours} />
      </section>

      <HoursForm placeSlug={place.slug} defaults={defaults} />
    </main>
  )
}

function hoursToFormDefaults(hours: OpeningHours): HoursFormDefaults {
  if (hours.kind === 'scheduled') {
    return {
      timezone: coerceTimezone(hours.timezone),
      recurring: hours.recurring,
      exceptions: hours.exceptions,
    }
  }
  if (hours.kind === 'always_open') {
    return {
      timezone: coerceTimezone(hours.timezone),
      recurring: [],
      exceptions: [],
    }
  }
  return {
    timezone: 'America/Argentina/Buenos_Aires',
    recurring: [],
    exceptions: [],
  }
}

function coerceTimezone(tz: string): (typeof ALLOWED_TIMEZONES)[number] {
  // `parseOpeningHours` ya valida contra la allowlist; este cast es solo para
  // que TS vea el tipo de tupla. Si alguna vez cambia la allowlist y un tz
  // antiguo queda fuera, cae al default al re-parsear.
  return (ALLOWED_TIMEZONES as readonly string[]).includes(tz)
    ? (tz as (typeof ALLOWED_TIMEZONES)[number])
    : 'America/Argentina/Buenos_Aires'
}
