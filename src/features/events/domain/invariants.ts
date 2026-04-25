/**
 * Invariantes del slice `events`. Funciones puras — sin Prisma, Next, React.
 *
 * Reglas de negocio (longitud de título, fechas válidas, timezone IANA, note
 * sólo en estados condicionales) se expresan como `validate*` que lanzan
 * `ValidationError`. CHECK constraints en DB son defensa en profundidad de
 * los mismos invariants.
 *
 * Ver `docs/features/events/spec.md` § 4 (invariantes) + spec-rsvp.md § 2.
 */

import { ValidationError } from '@/shared/errors/domain-error'
import { isAllowedTimezone } from '@/features/hours/public'
import { assertNever } from '@/shared/lib/assert-never'
import type { AuthorSnapshot, RSVPState } from './types'
import { RSVPState as RSVPStateValues } from './types'

// ---------------------------------------------------------------
// Constantes del dominio
// ---------------------------------------------------------------

export const EVENT_TITLE_MIN_LENGTH = 3
export const EVENT_TITLE_MAX_LENGTH = 120
export const EVENT_LOCATION_MAX_LENGTH = 200
export const EVENT_RSVP_NOTE_MAX_LENGTH = 280
/** Sanity cap: eventos > 7 días son sospechosos en F1. Spec § 4. */
export const EVENT_MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000

// ---------------------------------------------------------------
// Title
// ---------------------------------------------------------------

export function validateEventTitle(title: string): void {
  const trimmed = title.trim()
  if (trimmed.length < EVENT_TITLE_MIN_LENGTH) {
    throw new ValidationError(
      `El título debe tener al menos ${EVENT_TITLE_MIN_LENGTH} caracteres.`,
      { length: trimmed.length },
    )
  }
  if (trimmed.length > EVENT_TITLE_MAX_LENGTH) {
    throw new ValidationError(`El título no puede superar ${EVENT_TITLE_MAX_LENGTH} caracteres.`, {
      length: trimmed.length,
    })
  }
}

// ---------------------------------------------------------------
// Times (startsAt, endsAt)
// ---------------------------------------------------------------

export type EventTimesInput = {
  startsAt: Date
  endsAt: Date | null
}

/**
 * Valida `startsAt`/`endsAt` al crear o actualizar un evento.
 *
 * - `startsAt > now` exigido **sólo en create** — en update permitimos editar
 *   un evento que ya empezó (típico: corregir typo de descripción mientras pasa).
 * - `endsAt > startsAt` siempre que `endsAt` esté presente.
 * - Duración ≤ 7 días siempre.
 */
export function validateEventTimes(
  input: EventTimesInput,
  now: Date,
  options: { requireFuture: boolean } = { requireFuture: true },
): void {
  if (options.requireFuture && input.startsAt <= now) {
    throw new ValidationError('El evento debe empezar en el futuro.', {
      startsAt: input.startsAt.toISOString(),
      now: now.toISOString(),
    })
  }
  if (input.endsAt) {
    if (input.endsAt <= input.startsAt) {
      throw new ValidationError('La hora de fin debe ser posterior a la de inicio.', {
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
      })
    }
    const durationMs = input.endsAt.getTime() - input.startsAt.getTime()
    if (durationMs > EVENT_MAX_DURATION_MS) {
      throw new ValidationError('Eventos de más de 7 días no son soportados en F1.', {
        durationMs,
        maxMs: EVENT_MAX_DURATION_MS,
      })
    }
  }
}

// ---------------------------------------------------------------
// Timezone
// ---------------------------------------------------------------

export function validateEventTimezone(timezone: string): void {
  if (!isAllowedTimezone(timezone)) {
    throw new ValidationError(`Timezone "${timezone}" no está en la whitelist permitida.`, {
      timezone,
    })
  }
}

// ---------------------------------------------------------------
// Location
// ---------------------------------------------------------------

export function validateEventLocation(location: string | null | undefined): void {
  if (location == null) return
  if (location.length > EVENT_LOCATION_MAX_LENGTH) {
    throw new ValidationError(
      `La ubicación no puede superar ${EVENT_LOCATION_MAX_LENGTH} caracteres.`,
      { length: location.length },
    )
  }
}

// ---------------------------------------------------------------
// RSVP note
// ---------------------------------------------------------------

/**
 * `note` sólo es válido en `GOING_CONDITIONAL` y `NOT_GOING_CONTRIBUTING`
 * (los 2 estados condicionales). Texto en `GOING` o `NOT_GOING` es ruido —
 * los estados son auto-explicativos. Ver spec-rsvp.md § 2.
 *
 * `note` puede ser null/empty incluso en estados condicionales (el usuario
 * elige "voy si…" sin completar). Sólo validamos longitud cuando hay texto.
 */
export function validateRsvpNote(state: RSVPState, note: string | null | undefined): void {
  const hasText = note != null && note.length > 0
  if (!hasText) return

  switch (state) {
    case RSVPStateValues.GOING_CONDITIONAL:
    case RSVPStateValues.NOT_GOING_CONTRIBUTING:
      if (note.length > EVENT_RSVP_NOTE_MAX_LENGTH) {
        throw new ValidationError(
          `La nota no puede superar ${EVENT_RSVP_NOTE_MAX_LENGTH} caracteres.`,
          { length: note.length },
        )
      }
      return
    case RSVPStateValues.GOING:
    case RSVPStateValues.NOT_GOING:
      throw new ValidationError('La nota sólo aplica si "Voy si…" o "No voy, pero aporto…".', {
        state,
      })
    default:
      return assertNever(state)
  }
}

/**
 * Normaliza el `note` para persistir: en estados sin textura, el server
 * descarta cualquier `note` que el cliente haya mandado. Resultado: la DB
 * nunca tiene `note` desalineado con el estado (defensa adicional al CHECK
 * constraint).
 */
export function normalizeRsvpNote(
  state: RSVPState,
  note: string | null | undefined,
): string | null {
  switch (state) {
    case RSVPStateValues.GOING_CONDITIONAL:
    case RSVPStateValues.NOT_GOING_CONTRIBUTING: {
      if (note == null) return null
      const trimmed = note.trim()
      return trimmed.length === 0 ? null : trimmed
    }
    case RSVPStateValues.GOING:
    case RSVPStateValues.NOT_GOING:
      return null
    default:
      return assertNever(state)
  }
}

// ---------------------------------------------------------------
// Author snapshot (mismo shape que discussions)
// ---------------------------------------------------------------

export function buildEventAuthorSnapshot(user: {
  displayName: string
  avatarUrl: string | null
}): AuthorSnapshot {
  return { displayName: user.displayName, avatarUrl: user.avatarUrl }
}
