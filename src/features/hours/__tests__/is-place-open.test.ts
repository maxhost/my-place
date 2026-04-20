import { describe, it, expect } from 'vitest'
import { isPlaceOpen, nextOpeningWindow } from '../domain/invariants'
import type { DateException, OpeningHours } from '../domain/types'

const BA = 'America/Argentina/Buenos_Aires'
const MAD = 'Europe/Madrid'

describe('isPlaceOpen — unconfigured', () => {
  it('siempre cerrado, opensAt null', () => {
    const h: OpeningHours = { kind: 'unconfigured' }
    expect(isPlaceOpen(h, new Date('2026-05-07T10:00:00Z'))).toEqual({
      open: false,
      opensAt: null,
    })
  })
})

describe('isPlaceOpen — always_open', () => {
  it('siempre abierto, closesAt null', () => {
    const h: OpeningHours = { kind: 'always_open', timezone: BA }
    expect(isPlaceOpen(h, new Date('2026-05-07T10:00:00Z'))).toEqual({
      open: true,
      closesAt: null,
    })
  })
})

describe('isPlaceOpen — scheduled con ventana simple', () => {
  const hours: OpeningHours = {
    kind: 'scheduled',
    timezone: BA,
    recurring: [{ day: 'THU', start: '19:00', end: '23:00' }],
    exceptions: [],
  }

  it('jueves 20:00 BA → abierto, cierra a las 23:00 BA', () => {
    // 20:00 BA (UTC-3) == 23:00 UTC.
    const now = new Date('2026-05-07T23:00:00Z') // jueves BA
    const status = isPlaceOpen(hours, now)
    expect(status.open).toBe(true)
    if (status.open) {
      // 23:00 BA = 02:00 UTC del viernes.
      expect(status.closesAt?.toISOString()).toBe('2026-05-08T02:00:00.000Z')
    }
  })

  it('jueves 18:59 BA → cerrado, opensAt = jueves 19:00 BA', () => {
    const now = new Date('2026-05-07T21:59:00Z') // 18:59 BA
    const status = isPlaceOpen(hours, now)
    expect(status.open).toBe(false)
    if (!status.open) {
      expect(status.opensAt?.toISOString()).toBe('2026-05-07T22:00:00.000Z')
    }
  })

  it('viernes 10:00 BA → cerrado, opensAt = próximo jueves 19:00 BA', () => {
    const now = new Date('2026-05-08T13:00:00Z') // viernes 10:00 BA
    const status = isPlaceOpen(hours, now)
    expect(status.open).toBe(false)
    if (!status.open) {
      // próximo jueves = 2026-05-14 19:00 BA = 2026-05-14 22:00 UTC
      expect(status.opensAt?.toISOString()).toBe('2026-05-14T22:00:00.000Z')
    }
  })

  it('sábado (no es THU) → cerrado sin excepción', () => {
    const now = new Date('2026-05-09T15:00:00Z')
    const status = isPlaceOpen(hours, now)
    expect(status.open).toBe(false)
  })
})

describe('isPlaceOpen — múltiples ventanas mismo día', () => {
  const hours: OpeningHours = {
    kind: 'scheduled',
    timezone: BA,
    recurring: [
      { day: 'MON', start: '07:00', end: '11:00' },
      { day: 'MON', start: '15:00', end: '20:00' },
    ],
    exceptions: [],
  }

  it('lunes 08:00 BA → abierto en la ventana matutina', () => {
    const now = new Date('2026-05-04T11:00:00Z') // 08:00 BA
    const s = isPlaceOpen(hours, now)
    expect(s.open).toBe(true)
  })

  it('lunes 13:00 BA → cerrado entre ventanas, opensAt = 15:00 BA', () => {
    const now = new Date('2026-05-04T16:00:00Z') // 13:00 BA
    const s = isPlaceOpen(hours, now)
    expect(s.open).toBe(false)
    if (!s.open) {
      expect(s.opensAt?.toISOString()).toBe('2026-05-04T18:00:00.000Z') // 15:00 BA
    }
  })

  it('lunes 16:00 BA → abierto en la ventana vespertina', () => {
    const now = new Date('2026-05-04T19:00:00Z') // 16:00 BA
    const s = isPlaceOpen(hours, now)
    expect(s.open).toBe(true)
  })
})

describe('isPlaceOpen — excepciones', () => {
  const base = (exceptions: DateException[]): OpeningHours => ({
    kind: 'scheduled',
    timezone: BA,
    recurring: [{ day: 'FRI', start: '09:00', end: '18:00' }],
    exceptions,
  })

  it('excepción closed override el recurring del día', () => {
    const hours = base([{ date: '2026-12-25', closed: true }])
    // 25 dic 2026 es viernes. A las 12:00 BA debería estar cerrado.
    const now = new Date('2026-12-25T15:00:00Z') // 12:00 BA
    const s = isPlaceOpen(hours, now)
    expect(s.open).toBe(false)
  })

  it('excepción con windows abre un día que no tiene recurring', () => {
    // Sábado normalmente cerrado. Excepción abre 10-17.
    const hours = base([{ date: '2026-04-25', windows: [{ start: '10:00', end: '17:00' }] }])
    const now = new Date('2026-04-25T16:00:00Z') // 13:00 BA, sábado
    const s = isPlaceOpen(hours, now)
    expect(s.open).toBe(true)
    if (s.open) {
      expect(s.closesAt?.toISOString()).toBe('2026-04-25T20:00:00.000Z') // 17:00 BA
    }
  })

  it('nextOpeningWindow salta sobre excepción closed', () => {
    // Viernes normal, excepción cerrada el próximo viernes → siguiente = viernes+7
    const hours = base([{ date: '2026-05-15', closed: true }])
    const now = new Date('2026-05-15T10:00:00Z') // viernes 07:00 BA
    const s = isPlaceOpen(hours, now)
    expect(s.open).toBe(false)
    if (!s.open) {
      // próximo viernes: 2026-05-22 09:00 BA = 12:00 UTC
      expect(s.opensAt?.toISOString()).toBe('2026-05-22T12:00:00.000Z')
    }
  })
})

describe('isPlaceOpen — timezone awareness', () => {
  it('viewer en UTC, place en Madrid: mismo Instant, cálculo por timezone del place', () => {
    // Place Madrid, ventana MON 10-14. En verano Madrid = UTC+2.
    const hours: OpeningHours = {
      kind: 'scheduled',
      timezone: MAD,
      recurring: [{ day: 'MON', start: '10:00', end: '14:00' }],
      exceptions: [],
    }
    // 2026-07-06 es lunes. 11:00 Madrid = 09:00 UTC.
    const now = new Date('2026-07-06T09:00:00Z')
    const s = isPlaceOpen(hours, now)
    expect(s.open).toBe(true)
  })

  it('cambio de DST no rompe el cálculo (spring-forward Madrid)', () => {
    // Último domingo de marzo 2026: Madrid adelanta de 02:00 a 03:00.
    // Una ventana MON 09-12 en Madrid el lunes siguiente sigue siendo 09-12 hora local.
    const hours: OpeningHours = {
      kind: 'scheduled',
      timezone: MAD,
      recurring: [{ day: 'MON', start: '09:00', end: '12:00' }],
      exceptions: [],
    }
    // Lunes 2026-03-30 11:00 Madrid = 09:00 UTC (ya en horario de verano: UTC+2).
    const now = new Date('2026-03-30T09:00:00Z')
    const s = isPlaceOpen(hours, now)
    expect(s.open).toBe(true)
  })
})

describe('nextOpeningWindow standalone', () => {
  it('retorna null si place unconfigured', () => {
    expect(nextOpeningWindow({ kind: 'unconfigured' }, new Date())).toBeNull()
  })

  it('retorna null si always_open (ya está abierto para siempre)', () => {
    expect(nextOpeningWindow({ kind: 'always_open', timezone: 'UTC' }, new Date())).toBeNull()
  })

  it('retorna null si no hay ventanas en 14 días', () => {
    const hours: OpeningHours = {
      kind: 'scheduled',
      timezone: 'UTC',
      recurring: [],
      exceptions: [],
    }
    expect(nextOpeningWindow(hours, new Date('2026-05-07T10:00:00Z'))).toBeNull()
  })
})
