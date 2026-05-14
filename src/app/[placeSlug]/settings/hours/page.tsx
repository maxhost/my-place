import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { PageHeader } from '@/shared/ui/page-header'
import { ALLOWED_TIMEZONES, parseOpeningHours, type OpeningHours } from '@/features/hours/public'
import { HoursForm, type HoursFormDefaults } from '@/features/hours/admin/public'

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
    <div className="mx-auto max-w-screen-md space-y-6 px-3 py-6 md:px-4 md:py-8">
      <PageHeader
        title="Horario"
        description="Un place nace cerrado; configurá ventanas para que los miembros puedan entrar."
      />

      <HoursForm placeSlug={place.slug} defaults={defaults} />
    </div>
  )
}

function hoursToFormDefaults(hours: OpeningHours): HoursFormDefaults {
  if (hours.kind === 'scheduled') {
    return {
      timezone: coerceTimezone(hours.timezone),
      alwaysOpen: false,
      recurring: hours.recurring,
      exceptions: hours.exceptions,
    }
  }
  if (hours.kind === 'always_open') {
    return {
      timezone: coerceTimezone(hours.timezone),
      alwaysOpen: true,
      recurring: [],
      exceptions: [],
    }
  }
  return {
    timezone: 'America/Argentina/Buenos_Aires',
    alwaysOpen: false,
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
