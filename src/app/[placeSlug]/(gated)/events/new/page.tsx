import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { resolveViewerForPlace } from '@/features/discussions/public.server'
import { ALLOWED_TIMEZONES } from '@/features/hours/public'
import { EventForm } from '@/features/events/public'

export const metadata: Metadata = {
  title: 'Proponer evento',
}

type Props = {
  params: Promise<{ placeSlug: string }>
}

/**
 * Página de crear evento. Reusa `EventForm` en modo `create`. F1 permite
 * a cualquier miembro proponer. Permisos granulares (todos/lista/admin)
 * diferidos a post-F1.
 */
export default async function NewEventPage({ params }: Props) {
  const { placeSlug } = await params
  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) notFound()

  // Re-validamos membership (defensa en profundidad — el (gated) layout ya
  // bloquea no-miembros).
  await resolveViewerForPlace({ placeSlug })

  return (
    <div className="space-y-6 p-4 md:p-8">
      <header>
        <h1 className="font-serif text-2xl italic text-text">Proponer evento</h1>
        <p className="mt-1 text-sm text-muted">
          Una invitación al place. Los miembros pueden responder con cuánto pueden.
        </p>
      </header>
      <EventForm
        mode={{ kind: 'create', placeId: place.id }}
        placeId={place.id}
        allowedTimezones={ALLOWED_TIMEZONES}
      />
    </div>
  )
}
