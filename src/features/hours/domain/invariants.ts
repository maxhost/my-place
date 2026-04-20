import { Temporal } from '@js-temporal/polyfill'
import { InvariantViolation } from '@/shared/errors/domain-error'
import {
  type DateException,
  type DayOfWeek,
  type OpeningHours,
  type OpenStatus,
  type TimeOfDay,
} from './types'
import { isAllowedTimezone } from './timezones'

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Invariantes del dominio `hours`. Estas funciones lanzan `InvariantViolation`
 * si se viola una regla estructural; los borders (Zod en schemas.ts) las usan
 * para mensajes de error legibles además de testearse directamente.
 *
 * Las reglas completas viven en `docs/features/hours/spec.md` § "Invariantes".
 */

export function assertValidTime(t: TimeOfDay): void {
  if (!TIME_RE.test(t)) {
    throw new InvariantViolation(`Hora inválida: ${t}`, { value: t })
  }
}

export function assertValidDate(d: string): void {
  if (!DATE_RE.test(d)) {
    throw new InvariantViolation(`Fecha inválida (YYYY-MM-DD): ${d}`, { value: d })
  }
}

export function assertValidWindow({ start, end }: { start: TimeOfDay; end: TimeOfDay }): void {
  assertValidTime(start)
  assertValidTime(end)
  if (start >= end) {
    throw new InvariantViolation(
      `Ventana inválida ${start}-${end}: start debe ser < end (cross-midnight no soportado)`,
      { start, end },
    )
  }
}

export function assertNoOverlap(
  windows: ReadonlyArray<{ start: TimeOfDay; end: TimeOfDay }>,
): void {
  const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start))
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!
    const curr = sorted[i]!
    if (curr.start < prev.end) {
      throw new InvariantViolation('Ventanas solapadas', { a: prev, b: curr })
    }
  }
}

export function assertValidTimezone(tz: string): void {
  if (!isAllowedTimezone(tz)) {
    throw new InvariantViolation(`Timezone no permitido: ${tz}`, { value: tz })
  }
}

export function assertUniqueExceptionDates(exceptions: ReadonlyArray<DateException>): void {
  const seen = new Set<string>()
  for (const ex of exceptions) {
    if (seen.has(ex.date)) {
      throw new InvariantViolation(`Fecha de excepción duplicada: ${ex.date}`, {
        date: ex.date,
      })
    }
    seen.add(ex.date)
  }
}

// Temporal.PlainDate.dayOfWeek: 1=Monday .. 7=Sunday (ISO 8601).
const DOW_FROM_TEMPORAL: Readonly<Record<number, DayOfWeek>> = {
  1: 'MON',
  2: 'TUE',
  3: 'WED',
  4: 'THU',
  5: 'FRI',
  6: 'SAT',
  7: 'SUN',
}

function toZoned(now: Date, tz: string): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(tz)
}

function localDateKey(zdt: Temporal.ZonedDateTime): string {
  return `${String(zdt.year).padStart(4, '0')}-${String(zdt.month).padStart(2, '0')}-${String(zdt.day).padStart(2, '0')}`
}

function localHhMm(zdt: Temporal.ZonedDateTime): TimeOfDay {
  return `${String(zdt.hour).padStart(2, '0')}:${String(zdt.minute).padStart(2, '0')}`
}

function zonedAt(dateKey: string, time: TimeOfDay, tz: string): Temporal.ZonedDateTime {
  const [yStr, mStr, dStr] = dateKey.split('-')
  const [hStr, miStr] = time.split(':')
  return Temporal.ZonedDateTime.from({
    year: Number(yStr),
    month: Number(mStr),
    day: Number(dStr),
    hour: Number(hStr),
    minute: Number(miStr),
    timeZone: tz,
  })
}

function effectiveWindowsFor(
  dateKey: string,
  dow: DayOfWeek,
  hours: Extract<OpeningHours, { kind: 'scheduled' }>,
): ReadonlyArray<{ start: TimeOfDay; end: TimeOfDay }> | 'closed_by_exception' {
  const ex = hours.exceptions.find((e) => e.date === dateKey)
  if (ex) {
    if ('closed' in ex) return 'closed_by_exception'
    return ex.windows
  }
  return hours.recurring.filter((r) => r.day === dow).map((r) => ({ start: r.start, end: r.end }))
}

/**
 * Determina si el place está abierto en `now` (UTC).
 * - `unconfigured` → siempre cerrado (`opensAt: null`).
 * - `always_open` → siempre abierto (`closesAt: null`).
 * - `scheduled` → convierte `now` al timezone del place, busca excepción del día
 *   (si existe, override absoluto de las recurring de ese DOW), sino usa las
 *   recurring. Devuelve el próximo `opensAt` si está cerrado (hasta 14 días
 *   adelante).
 *
 * Ver `docs/features/hours/spec.md` § "Contrato de horario y timezone".
 */
export function isPlaceOpen(hours: OpeningHours, now: Date): OpenStatus {
  if (hours.kind === 'unconfigured') return { open: false, opensAt: null }
  if (hours.kind === 'always_open') return { open: true, closesAt: null }

  const zNow = toZoned(now, hours.timezone)
  const todayKey = localDateKey(zNow)
  const dow = DOW_FROM_TEMPORAL[zNow.dayOfWeek]!
  const windows = effectiveWindowsFor(todayKey, dow, hours)

  if (windows !== 'closed_by_exception') {
    const nowTime = localHhMm(zNow)
    for (const w of windows) {
      if (nowTime >= w.start && nowTime < w.end) {
        const closes = zonedAt(todayKey, w.end, hours.timezone)
        return { open: true, closesAt: new Date(closes.epochMilliseconds) }
      }
    }
  }

  return { open: false, opensAt: nextOpeningWindow(hours, now) }
}

/**
 * Próximo instante en que el place abre después de `now`. Escanea hasta 14 días
 * hacia adelante en el timezone del place. `null` si no hay ventana en ese rango
 * (place `unconfigured`, o `scheduled` con recurring vacío y sin excepciones
 * dentro de 14 días).
 */
export function nextOpeningWindow(hours: OpeningHours, now: Date): Date | null {
  if (hours.kind === 'unconfigured') return null
  if (hours.kind === 'always_open') return null

  const zNow = toZoned(now, hours.timezone)
  const nowMs = now.getTime()

  for (let offset = 0; offset < 14; offset++) {
    const day = zNow.add({ days: offset })
    const dKey = localDateKey(day)
    const dow = DOW_FROM_TEMPORAL[day.dayOfWeek]!
    const windows = effectiveWindowsFor(dKey, dow, hours)
    if (windows === 'closed_by_exception') continue
    const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start))
    for (const w of sorted) {
      const startZ = zonedAt(dKey, w.start, hours.timezone)
      if (startZ.epochMilliseconds > nowMs) {
        return new Date(startZ.epochMilliseconds)
      }
    }
  }
  return null
}
