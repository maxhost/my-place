/**
 * Zod schemas de input de server actions del slice `events`.
 *
 * Re-usan `richTextDocumentSchema` de discussions para `description` (TipTap
 * AST). El detalle del modelo + invariantes vive en `domain/invariants.ts` —
 * acá sólo definimos la forma del input que viene del cliente o de tests.
 *
 * Ver `docs/features/events/spec.md` § 4.
 */

import { z } from 'zod'
import { isAllowedTimezone } from '@/features/hours/public'
import {
  EVENT_LOCATION_MAX_LENGTH,
  EVENT_RSVP_NOTE_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
  EVENT_TITLE_MIN_LENGTH,
} from './domain/invariants'
import { RSVPState } from './domain/types'

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

const titleSchema = z
  .string()
  .min(EVENT_TITLE_MIN_LENGTH)
  .max(EVENT_TITLE_MAX_LENGTH)
  .refine((s) => s.trim().length >= EVENT_TITLE_MIN_LENGTH, {
    message: `El título debe tener al menos ${EVENT_TITLE_MIN_LENGTH} caracteres tras trim.`,
  })

const timezoneSchema = z.string().refine(isAllowedTimezone, {
  message: 'Timezone no permitido. Ver lista en hours.',
})

const locationSchema = z.string().max(EVENT_LOCATION_MAX_LENGTH).nullable().optional()

/**
 * Coerce string ISO o Date al objeto Date. Acepta ambos para que Server Actions
 * que reciben FormData strings + tests que pasan Date queden cubiertos.
 */
const datetimeSchema = z.coerce.date()

// ---------------------------------------------------------------
// createEventInput
// ---------------------------------------------------------------

export const createEventInputSchema = z
  .object({
    placeId: z.string().min(1),
    title: titleSchema,
    // stub F.1, re-apretar a richTextDocumentSchema en F.2
    description: z.unknown().nullable().optional(),
    startsAt: datetimeSchema,
    endsAt: datetimeSchema.nullable().optional(),
    timezone: timezoneSchema,
    location: locationSchema,
  })
  .strict()

export type CreateEventInput = z.infer<typeof createEventInputSchema>

// ---------------------------------------------------------------
// updateEventInput
// ---------------------------------------------------------------

export const updateEventInputSchema = z
  .object({
    eventId: z.string().min(1),
    title: titleSchema,
    // stub F.1, re-apretar a richTextDocumentSchema en F.2
    description: z.unknown().nullable().optional(),
    startsAt: datetimeSchema,
    endsAt: datetimeSchema.nullable().optional(),
    timezone: timezoneSchema,
    location: locationSchema,
  })
  .strict()

export type UpdateEventInput = z.infer<typeof updateEventInputSchema>

// ---------------------------------------------------------------
// cancelEventInput
// ---------------------------------------------------------------

export const cancelEventInputSchema = z
  .object({
    eventId: z.string().min(1),
  })
  .strict()

export type CancelEventInput = z.infer<typeof cancelEventInputSchema>

// ---------------------------------------------------------------
// rsvpEventInput
// ---------------------------------------------------------------

export const rsvpEventInputSchema = z
  .object({
    eventId: z.string().min(1),
    state: z.nativeEnum(RSVPState),
    note: z.string().max(EVENT_RSVP_NOTE_MAX_LENGTH).nullable().optional(),
  })
  .strict()

export type RsvpEventInput = z.infer<typeof rsvpEventInputSchema>
