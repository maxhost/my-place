/**
 * Algoritmo de momentos del evento — estado derivado puro.
 *
 * Calculado a partir de `startsAt`/`endsAt`/`cancelledAt` + `now`. NO se
 * persiste en DB para evitar drift; cada render server-side lo recalcula.
 *
 * Decisiones documentadas en `docs/features/events/spec.md § 5`:
 *  - Sin buffer pre-`startsAt` (sin urgencia artificial).
 *  - Default 2h cuando `endsAt` es null (evita "happening" indefinido).
 *  - `cancelled` es estado terminal — prevalece sobre upcoming/happening/past.
 */

import type { EventState } from './types'

/** Duración por defecto de un evento sin `endsAt` explícito (2 horas). */
export const DEFAULT_EVENT_DURATION_MS = 2 * 60 * 60 * 1000

export type DeriveEventStateInput = {
  startsAt: Date
  endsAt: Date | null
  cancelledAt: Date | null
}

export function deriveEventState(event: DeriveEventStateInput, now: Date): EventState {
  if (event.cancelledAt) return 'cancelled'
  if (now < event.startsAt) return 'upcoming'

  const effectiveEnd =
    event.endsAt ?? new Date(event.startsAt.getTime() + DEFAULT_EVENT_DURATION_MS)

  if (now < effectiveEnd) return 'happening'
  return 'past'
}
