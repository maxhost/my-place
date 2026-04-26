import { describe, expect, it } from 'vitest'
import {
  formatEventCompactDate,
  formatEventTimeRange,
  formatEventDateParts,
} from '../ui/format-event-time'

/**
 * Tests focalizados en los helpers nuevos del rebrand F.G. Cubrimos:
 * - Determinismo por timezone (mismo `Date` en distintos TZ → distinto output).
 * - Output stripping del punto final del locale es-AR ("sáb." → "Sáb").
 * - Mismo día vs cross-day en el rango horario.
 *
 * Nota: usamos un `Date` UTC explícito para que el test no dependa del TZ
 * de la máquina que lo corre (CI usa UTC; macos local usa America/Argentina).
 */
describe('formatEventCompactDate', () => {
  it('formatea sáb 27 abr en TZ Buenos Aires', () => {
    // 2026-04-27T13:00:00 UTC = 2026-04-27 10:00 ART (UTC-3)
    const date = new Date('2026-04-27T13:00:00Z')
    expect(formatEventCompactDate(date, 'America/Argentina/Buenos_Aires')).toBe('Lun 27 Abr')
  })

  it('mismo Date en TZ distinto puede dar día distinto cuando cruza medianoche', () => {
    // 2026-04-28T02:00:00 UTC = 2026-04-27 23:00 ART = 2026-04-28 02:00 UTC
    const date = new Date('2026-04-28T02:00:00Z')
    const ar = formatEventCompactDate(date, 'America/Argentina/Buenos_Aires')
    const utc = formatEventCompactDate(date, 'Etc/UTC')
    expect(ar).toContain('27')
    expect(utc).toContain('28')
  })

  it('strippea punto final del locale es-AR (sáb. → Sáb)', () => {
    const date = new Date('2026-04-25T15:00:00Z')
    const out = formatEventCompactDate(date, 'America/Argentina/Buenos_Aires')
    expect(out).not.toMatch(/\./)
    expect(out).toMatch(/^[A-ZÁÉÍÓÚ][a-záéíóú]/)
  })
})

describe('formatEventTimeRange', () => {
  it('rango mismo día: "10:00–14:00"', () => {
    const start = new Date('2026-04-27T13:00:00Z') // 10 ART
    const end = new Date('2026-04-27T17:00:00Z') // 14 ART
    expect(formatEventTimeRange(start, end, 'America/Argentina/Buenos_Aires')).toBe('10:00–14:00')
  })

  it('sin endsAt: solo hora de inicio', () => {
    const start = new Date('2026-04-27T13:00:00Z')
    expect(formatEventTimeRange(start, null, 'America/Argentina/Buenos_Aires')).toBe('10:00')
  })

  it('cruza día: incluye fecha de fin entre paréntesis', () => {
    const start = new Date('2026-04-27T22:00:00Z') // 19 ART
    const end = new Date('2026-04-28T05:00:00Z') // 02 ART next day
    const out = formatEventTimeRange(start, end, 'America/Argentina/Buenos_Aires')
    expect(out).toMatch(/^19:00 → 02:00 \(28 /)
  })
})

describe('formatEventDateParts', () => {
  it('devuelve dow/day/month uppercase sin punto', () => {
    const date = new Date('2026-04-27T13:00:00Z') // Lun 27 abr ART
    const parts = formatEventDateParts(date, 'America/Argentina/Buenos_Aires')
    expect(parts.dow).toBe('LUN')
    expect(parts.day).toBe('27')
    expect(parts.month).toBe('ABR')
    expect(parts.dow).not.toMatch(/\./)
    expect(parts.month).not.toMatch(/\./)
  })

  it('mismo Date en TZ distinto puede dar día/dow distinto', () => {
    const date = new Date('2026-04-28T02:00:00Z')
    const ar = formatEventDateParts(date, 'America/Argentina/Buenos_Aires')
    const utc = formatEventDateParts(date, 'Etc/UTC')
    expect(ar.day).toBe('27')
    expect(utc.day).toBe('28')
  })
})
