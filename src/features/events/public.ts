/**
 * API pública client-safe del slice `events`. Tipos, domain helpers, schemas
 * Zod y Server Actions (callables desde Client Components vía boundary RSC).
 *
 * **No** incluye queries server-only (ver `public.server.ts`) — Next traza los
 * re-exports a través del bundle cliente cuando un Server Component que viaja
 * a un Client Component importa este archivo. Mezclar `import 'server-only'`
 * acá rompería el build (mismo patrón que `flags/public.ts` — ver
 * `docs/decisions/2026-04-21-flags-subslice-split.md`).
 *
 * Ver `docs/architecture.md` § boundaries y `docs/features/events/spec.md` § 3.
 */

// ---------------------------------------------------------------
// Tipos del dominio
// ---------------------------------------------------------------

export type {
  AuthorSnapshot,
  Event,
  EventDetailView,
  EventId,
  EventListView,
  EventRSVP,
  EventRSVPId,
  EventState,
  RSVPState,
} from './domain/types'

export { RSVPState as RSVPStateValues } from './domain/types'

// ---------------------------------------------------------------
// Algoritmo de momentos (función pura, server + client safe)
// ---------------------------------------------------------------

export {
  DEFAULT_EVENT_DURATION_MS,
  deriveEventState,
  type DeriveEventStateInput,
} from './domain/state-derivation'

// ---------------------------------------------------------------
// Invariantes y constantes (puros)
// ---------------------------------------------------------------

export {
  EVENT_LOCATION_MAX_LENGTH,
  EVENT_MAX_DURATION_MS,
  EVENT_RSVP_NOTE_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
  EVENT_TITLE_MIN_LENGTH,
  buildEventAuthorSnapshot,
  normalizeRsvpNote,
  validateEventLocation,
  validateEventTimes,
  validateEventTimezone,
  validateEventTitle,
  validateRsvpNote,
} from './domain/invariants'

// ---------------------------------------------------------------
// Schemas Zod (inputs de Server Actions)
// ---------------------------------------------------------------

export {
  cancelEventInputSchema,
  createEventInputSchema,
  rsvpEventInputSchema,
  updateEventInputSchema,
  type CancelEventInput,
  type CreateEventInput,
  type RsvpEventInput,
  type UpdateEventInput,
} from './schemas'

// ---------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------

export { createEventAction } from './server/actions/create'
export { updateEventAction } from './server/actions/update'
export { cancelEventAction } from './server/actions/cancel'
export { rsvpEventAction } from './server/actions/rsvp'

// ---------------------------------------------------------------
// UI components (Server + Client)
// ---------------------------------------------------------------

export { EventList } from './ui/event-list'
/** Header de metadata del evento, montado arriba del thread cuando
 *  `Post.event` está poblado. F.F: el evento ES el thread. */
export { EventMetadataHeader } from './ui/event-metadata-header'
export { EventForm } from './ui/event-form'
export { EventCancelledBadge } from './ui/event-cancelled-badge'
