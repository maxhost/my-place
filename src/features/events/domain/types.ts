/**
 * Tipos del dominio del slice `events`.
 *
 * Re-exporta tipos de Prisma que el slice expone via `public.ts`. Los tipos
 * derivados (views para UI) viven acá para evitar drift entre el shape de DB
 * y lo que la UI consume.
 *
 * Ver `docs/features/events/spec.md` § 4 (modelo de datos) y § 5 (algoritmo
 * de momentos / estado derivado).
 */

import type { Event as PrismaEvent, EventRSVP as PrismaEventRSVP } from '@prisma/client'
import { RSVPState as PrismaRSVPState } from '@prisma/client'

export type Event = PrismaEvent
export type EventRSVP = PrismaEventRSVP
export type EventId = Event['id']
export type EventRSVPId = EventRSVP['id']

/**
 * Estados RSVP texturados (4 valores) — alineados con la ontología
 * (`docs/ontologia/eventos.md § Participantes`).
 *
 * - `GOING`                  → "voy"
 * - `GOING_CONDITIONAL`      → "voy si X" (note explica el "si")
 * - `NOT_GOING_CONTRIBUTING` → "no voy pero aporto Y" (note explica el aporte)
 * - `NOT_GOING`              → "no voy"
 *
 * Ver `docs/features/events/spec-rsvp.md` § 1.
 */
export const RSVPState = PrismaRSVPState
export type RSVPState = (typeof RSVPState)[keyof typeof RSVPState]

/** Estado derivado del evento (calculado, no persistido). Ver spec.md § 5. */
export type EventState = 'upcoming' | 'happening' | 'past' | 'cancelled'

/**
 * Snapshot del autor congelado al crear el evento. Mismo shape que Post/Comment
 * (compatibilidad para erasure 365d — el job tx la 3 entidades igual).
 */
export type AuthorSnapshot = {
  displayName: string
  avatarUrl: string | null
}

/**
 * Vista de evento para listado (`/events`). Subset de campos suficiente para
 * renderizar `EventListItem` sin overfetch.
 */
export type EventListView = {
  id: string
  title: string
  startsAt: Date
  endsAt: Date | null
  timezone: string
  location: string | null
  cancelledAt: Date | null
  authorSnapshot: AuthorSnapshot
  state: EventState
  /** Count de confirmados (GOING + GOING_CONDITIONAL). */
  attendingCount: number
  /** RSVP del viewer si tiene una; sirve para mostrar su estado en la card. */
  viewerRsvpState: RSVPState | null
}

/**
 * Vista de evento para detalle (`/events/[eventId]`). Incluye todos los campos
 * + RSVPs públicas (filtradas a estados visibles) + RSVP del viewer.
 */
export type EventDetailView = {
  id: string
  placeId: string
  title: string
  description: unknown | null
  startsAt: Date
  endsAt: Date | null
  timezone: string
  location: string | null
  postId: string | null
  cancelledAt: Date | null
  createdAt: Date
  updatedAt: Date
  authorUserId: string | null
  authorSnapshot: AuthorSnapshot
  state: EventState
  publicAttendees: Array<{
    userId: string
    state: 'GOING' | 'GOING_CONDITIONAL'
    note: string | null
    displayName: string
    avatarUrl: string | null
  }>
  viewerOwnRsvp: { state: RSVPState; note: string | null } | null
  attendingCount: number
}
