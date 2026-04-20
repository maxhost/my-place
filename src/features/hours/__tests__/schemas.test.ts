import { describe, it, expect, vi } from 'vitest'
import { openingHoursSchema, parseOpeningHours, updateHoursInputSchema } from '../schemas'

vi.mock('@/shared/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

describe('openingHoursSchema', () => {
  it('acepta unconfigured', () => {
    expect(openingHoursSchema.safeParse({ kind: 'unconfigured' }).success).toBe(true)
  })

  it('acepta always_open con timezone válido', () => {
    expect(
      openingHoursSchema.safeParse({
        kind: 'always_open',
        timezone: 'America/Argentina/Buenos_Aires',
      }).success,
    ).toBe(true)
  })

  it('rechaza timezone fuera de la allowlist', () => {
    const res = openingHoursSchema.safeParse({
      kind: 'always_open',
      timezone: 'Atlantis/Lost_City',
    })
    expect(res.success).toBe(false)
  })

  it('rechaza ventana con end <= start', () => {
    const res = openingHoursSchema.safeParse({
      kind: 'scheduled',
      timezone: 'UTC',
      recurring: [{ day: 'MON', start: '20:00', end: '19:00' }],
      exceptions: [],
    })
    expect(res.success).toBe(false)
  })

  it('rechaza cross-midnight (start > end)', () => {
    const res = openingHoursSchema.safeParse({
      kind: 'scheduled',
      timezone: 'UTC',
      recurring: [{ day: 'SAT', start: '22:00', end: '01:00' }],
      exceptions: [],
    })
    expect(res.success).toBe(false)
  })

  it('rechaza overlap en mismo día', () => {
    const res = openingHoursSchema.safeParse({
      kind: 'scheduled',
      timezone: 'UTC',
      recurring: [
        { day: 'MON', start: '09:00', end: '12:00' },
        { day: 'MON', start: '11:00', end: '14:00' },
      ],
      exceptions: [],
    })
    expect(res.success).toBe(false)
  })

  it('acepta mismas horas en días distintos (no es overlap)', () => {
    const res = openingHoursSchema.safeParse({
      kind: 'scheduled',
      timezone: 'UTC',
      recurring: [
        { day: 'MON', start: '09:00', end: '12:00' },
        { day: 'TUE', start: '09:00', end: '12:00' },
      ],
      exceptions: [],
    })
    expect(res.success).toBe(true)
  })

  it('rechaza excepciones con fecha duplicada', () => {
    const res = openingHoursSchema.safeParse({
      kind: 'scheduled',
      timezone: 'UTC',
      recurring: [],
      exceptions: [
        { date: '2026-12-25', closed: true },
        {
          date: '2026-12-25',
          windows: [{ start: '10:00', end: '12:00' }],
        },
      ],
    })
    expect(res.success).toBe(false)
  })

  it('rechaza formato de time inválido', () => {
    const res = openingHoursSchema.safeParse({
      kind: 'scheduled',
      timezone: 'UTC',
      recurring: [{ day: 'MON', start: '9:00', end: '12:00' }],
      exceptions: [],
    })
    expect(res.success).toBe(false)
  })

  it('rechaza formato de date inválido', () => {
    const res = openingHoursSchema.safeParse({
      kind: 'scheduled',
      timezone: 'UTC',
      recurring: [],
      exceptions: [{ date: '25/12/2026', closed: true }],
    })
    expect(res.success).toBe(false)
  })
})

describe('parseOpeningHours', () => {
  it('{} → unconfigured', () => {
    expect(parseOpeningHours({})).toEqual({ kind: 'unconfigured' })
  })

  it('null/undefined → unconfigured', () => {
    expect(parseOpeningHours(null)).toEqual({ kind: 'unconfigured' })
    expect(parseOpeningHours(undefined)).toEqual({ kind: 'unconfigured' })
  })

  it('JSON corrupto → fallback a unconfigured (no throw)', () => {
    const res = parseOpeningHours({ kind: 'weird', foo: 'bar' })
    expect(res).toEqual({ kind: 'unconfigured' })
  })

  it('JSON válido → tipado', () => {
    const raw = {
      kind: 'scheduled',
      timezone: 'America/Argentina/Buenos_Aires',
      recurring: [{ day: 'THU', start: '19:00', end: '23:00' }],
      exceptions: [],
    }
    const parsed = parseOpeningHours(raw)
    expect(parsed.kind).toBe('scheduled')
  })
})

describe('updateHoursInputSchema', () => {
  it('acepta input válido', () => {
    const res = updateHoursInputSchema.safeParse({
      placeSlug: 'mi-place',
      timezone: 'UTC',
      recurring: [{ day: 'MON', start: '09:00', end: '18:00' }],
      exceptions: [],
    })
    expect(res.success).toBe(true)
  })

  it('exige placeSlug no vacío', () => {
    const res = updateHoursInputSchema.safeParse({
      placeSlug: '',
      timezone: 'UTC',
      recurring: [],
      exceptions: [],
    })
    expect(res.success).toBe(false)
  })
})
