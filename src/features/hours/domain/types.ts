/**
 * Tipos puros del slice `hours`. Sin dependencia de Prisma, Next ni React.
 *
 * El shape completo y la semántica viven en `docs/features/hours/spec.md`.
 * Resumen:
 * - `unconfigured` → place cerrado indefinidamente (default al crear).
 * - `always_open` → 24/7. Soportado en datos, no expuesto en UI en MVP.
 * - `scheduled` → ventanas recurrentes por día + excepciones por fecha, en `timezone` IANA.
 */

export type DayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'

/** `HH:MM` 24h, `00:00 ≤ start < end ≤ 23:59`. */
export type TimeOfDay = string

export type RecurringWindow = {
  day: DayOfWeek
  start: TimeOfDay
  end: TimeOfDay
}

export type DateException =
  | { date: string; closed: true }
  | { date: string; windows: Array<{ start: TimeOfDay; end: TimeOfDay }> }

export type OpeningHours =
  | { kind: 'unconfigured' }
  | { kind: 'always_open'; timezone: string }
  | {
      kind: 'scheduled'
      timezone: string
      recurring: RecurringWindow[]
      exceptions: DateException[]
    }

export type OpenStatus =
  | { open: true; closesAt: Date | null }
  | { open: false; opensAt: Date | null }

export const DAY_ORDER: readonly DayOfWeek[] = [
  'MON',
  'TUE',
  'WED',
  'THU',
  'FRI',
  'SAT',
  'SUN',
] as const
