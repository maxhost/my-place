import 'server-only'
import { prisma } from '@/db/client'
import { deriveEventState } from '../domain/state-derivation'
import type { AuthorSnapshot, EventDetailView, EventListView, RSVPState } from '../domain/types'
import { RSVPState as RSVPStateValues } from '../domain/types'

/**
 * Queries del slice `events`. Sólo este archivo + `server/actions/*` tocan
 * Prisma. El resto del slice (UI, domain) consume via `public.ts` /
 * `public.server.ts`.
 *
 * RLS está activa sobre `Event` y `EventRSVP` — un viewer sin membership
 * activa nunca ve filas. Acá no aplicamos filtro extra por placeId; la RLS
 * lo enforce. Cuando se usa el cliente Prisma con el actor authenticated,
 * Supabase aplica las policies. Acá usamos el `prisma` singleton que
 * **bypassea RLS** (service role) — el filtrado por place lo agregamos
 * explícitamente en el WHERE para mantener la igualdad funcional.
 */

const PUBLIC_RSVP_STATES = [RSVPStateValues.GOING, RSVPStateValues.GOING_CONDITIONAL] as const

// ---------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------

function readAuthorSnapshot(raw: unknown): AuthorSnapshot {
  if (raw && typeof raw === 'object' && 'displayName' in raw) {
    const obj = raw as { displayName: unknown; avatarUrl?: unknown }
    return {
      displayName: typeof obj.displayName === 'string' ? obj.displayName : 'ex-miembro',
      avatarUrl: typeof obj.avatarUrl === 'string' ? obj.avatarUrl : null,
    }
  }
  return { displayName: 'ex-miembro', avatarUrl: null }
}

// ---------------------------------------------------------------
// listEvents — para `/[placeSlug]/events`
// ---------------------------------------------------------------

/**
 * Lista eventos de un place. Sin paginación en F1 (cap razonable: < 100
 * eventos activos por place). Si crece, agregar cursor por `(startsAt, id)`.
 *
 * Devuelve `attendingCount` (count agregado de GOING + GOING_CONDITIONAL) y
 * `viewerRsvpState` para mostrar el estado del viewer en cada card sin
 * round-trips adicionales.
 */
export async function listEvents(params: {
  placeId: string
  viewerUserId: string
  now?: Date
}): Promise<EventListView[]> {
  const now = params.now ?? new Date()
  const events = await prisma.event.findMany({
    where: { placeId: params.placeId },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      timezone: true,
      location: true,
      cancelledAt: true,
      authorSnapshot: true,
    },
  })
  if (events.length === 0) return []

  const eventIds = events.map((e) => e.id)

  // Counts de confirmados (GOING + GOING_CONDITIONAL) por evento.
  const counts = await prisma.eventRSVP.groupBy({
    by: ['eventId'],
    where: { eventId: { in: eventIds }, state: { in: [...PUBLIC_RSVP_STATES] } },
    _count: { _all: true },
  })
  const countByEventId = new Map(counts.map((c) => [c.eventId, c._count._all]))

  // RSVPs del viewer sobre estos eventos.
  const viewerRsvps = await prisma.eventRSVP.findMany({
    where: { eventId: { in: eventIds }, userId: params.viewerUserId },
    select: { eventId: true, state: true },
  })
  const viewerStateByEventId = new Map(viewerRsvps.map((r) => [r.eventId, r.state]))

  return events.map((e) => ({
    id: e.id,
    title: e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    timezone: e.timezone,
    location: e.location,
    cancelledAt: e.cancelledAt,
    authorSnapshot: readAuthorSnapshot(e.authorSnapshot),
    state: deriveEventState(
      { startsAt: e.startsAt, endsAt: e.endsAt, cancelledAt: e.cancelledAt },
      now,
    ),
    attendingCount: countByEventId.get(e.id) ?? 0,
    viewerRsvpState: viewerStateByEventId.get(e.id) ?? null,
  }))
}

// ---------------------------------------------------------------
// getEvent — para `/[placeSlug]/events/[eventId]`
// ---------------------------------------------------------------

export async function getEvent(params: {
  eventId: string
  placeId: string
  viewerUserId: string
  now?: Date
}): Promise<EventDetailView | null> {
  const now = params.now ?? new Date()
  const event = await prisma.event.findFirst({
    where: { id: params.eventId, placeId: params.placeId },
  })
  if (!event) return null

  const { publicAttendees, viewerOwnRsvp, attendingCount } = await listEventRsvps({
    eventId: event.id,
    viewerUserId: params.viewerUserId,
  })

  return {
    id: event.id,
    placeId: event.placeId,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    location: event.location,
    postId: event.postId,
    cancelledAt: event.cancelledAt,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    authorUserId: event.authorUserId,
    authorSnapshot: readAuthorSnapshot(event.authorSnapshot),
    state: deriveEventState(
      { startsAt: event.startsAt, endsAt: event.endsAt, cancelledAt: event.cancelledAt },
      now,
    ),
    publicAttendees,
    viewerOwnRsvp,
    attendingCount,
  }
}

// ---------------------------------------------------------------
// listEventRsvps — RSVPs de un evento (públicas + viewer's own)
// ---------------------------------------------------------------

/**
 * Devuelve:
 *  - `publicAttendees`: array de RSVPs `GOING` + `GOING_CONDITIONAL` con
 *    join a User para mostrar avatar/displayName actualizado en la lista
 *    "Quién viene".
 *  - `viewerOwnRsvp`: la RSVP del viewer (cualquier estado), para que la UI
 *    muestre su elección sin filtrarla con la lista pública.
 *  - `attendingCount`: count agregado.
 *
 * `NOT_GOING` y `NOT_GOING_CONTRIBUTING` se filtran de `publicAttendees` por
 * regla ontológica ("quién no, no se presiona"). Ver spec-rsvp.md § 4.
 */
export async function listEventRsvps(params: { eventId: string; viewerUserId: string }): Promise<{
  publicAttendees: Array<{
    userId: string
    state: 'GOING' | 'GOING_CONDITIONAL'
    note: string | null
    displayName: string
    avatarUrl: string | null
  }>
  viewerOwnRsvp: { state: RSVPState; note: string | null } | null
  attendingCount: number
}> {
  const [publicRows, viewerRow] = await Promise.all([
    prisma.eventRSVP.findMany({
      where: {
        eventId: params.eventId,
        state: { in: [...PUBLIC_RSVP_STATES] },
      },
      orderBy: [{ updatedAt: 'asc' }],
      select: {
        userId: true,
        state: true,
        note: true,
        user: { select: { displayName: true, avatarUrl: true } },
      },
    }),
    prisma.eventRSVP.findUnique({
      where: { eventId_userId: { eventId: params.eventId, userId: params.viewerUserId } },
      select: { state: true, note: true },
    }),
  ])

  const publicAttendees = publicRows.map((r) => ({
    userId: r.userId,
    state: r.state as 'GOING' | 'GOING_CONDITIONAL',
    note: r.note,
    displayName: r.user.displayName,
    avatarUrl: r.user.avatarUrl,
  }))

  return {
    publicAttendees,
    viewerOwnRsvp: viewerRow ? { state: viewerRow.state, note: viewerRow.note } : null,
    attendingCount: publicAttendees.length,
  }
}
