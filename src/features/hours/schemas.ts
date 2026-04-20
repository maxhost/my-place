import { z } from 'zod'
import { logger } from '@/shared/lib/logger'
import type { OpeningHours } from './domain/types'
import { isAllowedTimezone } from './domain/timezones'

/**
 * Zod schemas del slice `hours`. Fuente única de verdad para:
 * - Validación del form (client y server via `zodResolver`).
 * - Parseo defensivo de `Place.openingHours` (JSONB) con fallback a `unconfigured`.
 *
 * Ver `docs/features/hours/spec.md` § "Shape de datos" + "Invariantes".
 */

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const timeSchema = z.string().regex(TIME_RE, 'Hora inválida (HH:MM 24h)')
const dateSchema = z.string().regex(DATE_RE, 'Fecha inválida (YYYY-MM-DD)')
const timezoneSchema = z.string().refine(isAllowedTimezone, { message: 'Timezone no permitido' })

const dayOfWeekSchema = z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])

const timeWindowSchema = z
  .object({ start: timeSchema, end: timeSchema })
  .refine((w) => w.start < w.end, {
    message: 'La ventana debe cumplir start < end (cross-midnight no soportado)',
  })

const recurringWindowSchema = z
  .object({ day: dayOfWeekSchema, start: timeSchema, end: timeSchema })
  .refine((w) => w.start < w.end, {
    message: 'La ventana debe cumplir start < end (cross-midnight no soportado)',
  })

const dateExceptionClosedSchema = z.object({
  date: dateSchema,
  closed: z.literal(true),
})

const dateExceptionWindowsSchema = z
  .object({ date: dateSchema, windows: z.array(timeWindowSchema).min(1) })
  .refine((ex) => !hasOverlap(ex.windows), {
    message: 'Las ventanas de la excepción se solapan',
  })

const dateExceptionSchema = z.union([dateExceptionClosedSchema, dateExceptionWindowsSchema])

const unconfiguredSchema = z.object({ kind: z.literal('unconfigured') })

const alwaysOpenSchema = z.object({
  kind: z.literal('always_open'),
  timezone: timezoneSchema,
})

const scheduledSchema = z
  .object({
    kind: z.literal('scheduled'),
    timezone: timezoneSchema,
    recurring: z.array(recurringWindowSchema),
    exceptions: z.array(dateExceptionSchema),
  })
  .refine((val) => !hasRecurringOverlapByDay(val.recurring), {
    message: 'Ventanas recurrentes solapadas en un mismo día',
  })
  .refine((val) => !hasDuplicateExceptionDate(val.exceptions), {
    message: 'Hay excepciones duplicadas para la misma fecha',
  })

export const openingHoursSchema = z.discriminatedUnion('kind', [
  unconfiguredSchema,
  alwaysOpenSchema,
  scheduledSchema,
])

/**
 * Input del form de settings. Siempre viaja en kind=`scheduled` (el toggle de
 * `always_open` no está en UI MVP; se setea por SQL). `unconfigured` se expresa
 * como scheduled con recurring/exceptions vacíos, lo que equivale a "cerrado
 * sin horas definidas" pero con timezone ya elegido.
 */
export const updateHoursInputSchema = z
  .object({
    placeSlug: z.string().min(1),
    timezone: timezoneSchema,
    recurring: z.array(recurringWindowSchema),
    exceptions: z.array(dateExceptionSchema),
  })
  .refine((val) => !hasRecurringOverlapByDay(val.recurring), {
    message: 'Ventanas recurrentes solapadas en un mismo día',
    path: ['recurring'],
  })
  .refine((val) => !hasDuplicateExceptionDate(val.exceptions), {
    message: 'Hay excepciones duplicadas para la misma fecha',
    path: ['exceptions'],
  })

export type UpdateHoursInput = z.infer<typeof updateHoursInputSchema>

/**
 * Parsea el JSON persistido en `Place.openingHours`. Fallback defensivo:
 * - `null` / `undefined` / `{}` → `{ kind: 'unconfigured' }` (default al crear).
 * - JSON válido → tipado.
 * - JSON corrupto → log `warn` estructurado + fallback a `unconfigured`.
 *
 * Jamás lanza. El place queda cerrado hasta que el JSON se arregle en DB.
 */
export function parseOpeningHours(raw: unknown): OpeningHours {
  if (raw == null) return { kind: 'unconfigured' }
  if (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw as object).length === 0) {
    return { kind: 'unconfigured' }
  }
  const result = openingHoursSchema.safeParse(raw)
  if (!result.success) {
    logger.warn(
      { raw, issues: result.error.issues },
      'place.openingHours corrupto: fallback a unconfigured',
    )
    return { kind: 'unconfigured' }
  }
  return result.data as OpeningHours
}

// --- helpers internos ---

function hasOverlap(windows: ReadonlyArray<{ start: string; end: string }>): boolean {
  const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start))
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.start < sorted[i - 1]!.end) return true
  }
  return false
}

function hasRecurringOverlapByDay(
  windows: ReadonlyArray<{ day: string; start: string; end: string }>,
): boolean {
  const byDay = new Map<string, Array<{ start: string; end: string }>>()
  for (const w of windows) {
    const list = byDay.get(w.day) ?? []
    list.push({ start: w.start, end: w.end })
    byDay.set(w.day, list)
  }
  for (const list of byDay.values()) {
    if (hasOverlap(list)) return true
  }
  return false
}

function hasDuplicateExceptionDate(exceptions: ReadonlyArray<{ date: string }>): boolean {
  const seen = new Set<string>()
  for (const ex of exceptions) {
    if (seen.has(ex.date)) return true
    seen.add(ex.date)
  }
  return false
}
