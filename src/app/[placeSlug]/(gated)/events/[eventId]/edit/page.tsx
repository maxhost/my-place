import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { resolveViewerForPlace } from '@/features/discussions/public.server'
import { ALLOWED_TIMEZONES } from '@/features/hours/public'
import { EventForm } from '@/features/events/public'
import { getEvent } from '@/features/events/public.server'

export const metadata: Metadata = {
  title: 'Editar evento',
}

type Props = { params: Promise<{ placeSlug: string; eventId: string }> }

/**
 * Página de editar evento. Sólo author o admin pueden entrar — si el viewer
 * no califica, redirigimos al detalle (mejor UX que 404; admin puede haber
 * navegado por UI y perdido permiso por timing).
 *
 * F1: la pantalla NO incluye opción para "transferir autoría". Si producto
 * lo pide, post-F1.
 */
export default async function EditEventPage({ params }: Props) {
  const { placeSlug, eventId } = await params
  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) notFound()

  const viewer = await resolveViewerForPlace({ placeSlug })
  const event = await getEvent({
    eventId,
    placeId: place.id,
    viewerUserId: viewer.actorId,
  })
  if (!event) notFound()

  const isAuthor = event.authorUserId !== null && event.authorUserId === viewer.actorId
  // F.F: el evento ES el thread; sin permiso para editar redirigimos al
  // thread (donde igualmente pueden ver el evento), no a una page que ya
  // no existe. `event.postSlug` viene incluido en `getEvent` (un solo
  // round-trip) — fallback al listado en el caso defensivo de evento sin
  // Post asociado.
  const fallbackUrl = event.postSlug ? `/conversations/${event.postSlug}` : '/events'
  if (!isAuthor && !viewer.isAdmin) {
    redirect(fallbackUrl)
  }

  // datetime-local quiere YYYY-MM-DDTHH:MM en hora local del browser.
  // Para edits, formateamos los Date persistidos como UTC al string que el
  // input acepta. F1: no convertimos al `event.timezone` — el input usa el
  // huso del browser (limitación de `<input type="datetime-local">`). Si
  // editor y evento están en distintos husos, el editor ve la hora local
  // del browser. Documentado.
  const initialDescription = extractPlainTextDescription(event.description)

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="font-serif text-2xl italic text-place-text">Editar evento</h1>
        <p className="mt-1 text-sm text-place-text-soft">
          Los cambios no se reflejan en el thread asociado (la conversación queda intacta).
        </p>
      </header>
      <EventForm
        mode={{
          kind: 'edit',
          eventId: event.id,
          initialTitle: event.title,
          initialDescription,
          initialStartsAt: toDatetimeLocal(event.startsAt),
          initialEndsAt: event.endsAt ? toDatetimeLocal(event.endsAt) : '',
          initialTimezone: event.timezone,
          initialLocation: event.location ?? '',
          postSlug: event.postSlug,
        }}
        allowedTimezones={ALLOWED_TIMEZONES}
      />
    </main>
  )
}

function toDatetimeLocal(d: Date): string {
  // YYYY-MM-DDTHH:MM en local time del server-render. El cliente lo recibe
  // como string y el browser interpretará como hora local del cliente — eso
  // es la limitación documentada arriba.
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())}`
}

function extractPlainTextDescription(desc: unknown): string {
  if (!desc || typeof desc !== 'object') return ''
  const doc = desc as { content?: Array<{ content?: Array<{ text?: string }> }> }
  if (!Array.isArray(doc.content)) return ''
  return doc.content
    .map((p) => (p.content ?? []).map((t) => t.text ?? '').join(''))
    .join('\n\n')
    .trim()
}
