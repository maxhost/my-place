import { describe, it, expect } from 'vitest'
import { currentOpeningWindow } from '../domain/invariants'
import type { OpeningHours } from '../domain/types'

const BA = 'America/Argentina/Buenos_Aires'
const MAD = 'Europe/Madrid'

describe('currentOpeningWindow — unconfigured', () => {
  it('retorna null (el place no abre sin configuración)', () => {
    const h: OpeningHours = { kind: 'unconfigured' }
    expect(currentOpeningWindow(h, new Date('2026-05-07T22:00:00Z'))).toBeNull()
  })
})

describe('currentOpeningWindow — always_open', () => {
  it('retorna null por contrato: la ventana eterna vive en PlaceOpening (endAt=null)', () => {
    // Rationale: always_open no tiene ventana acotada computable desde `hours`.
    // El slice de discussions orquesta la fila `PlaceOpening` con endAt=null;
    // hours permanece puro y sin I/O. Ver spec § "Contrato de apertura".
    const h: OpeningHours = { kind: 'always_open', timezone: BA }
    expect(currentOpeningWindow(h, new Date('2026-05-07T22:00:00Z'))).toBeNull()
  })
})

describe('currentOpeningWindow — scheduled dentro de ventana', () => {
  it('jueves 20:00 BA con ventana THU 19-23 → {start: 19:00 BA, end: 23:00 BA}', () => {
    const hours: OpeningHours = {
      kind: 'scheduled',
      timezone: BA,
      recurring: [{ day: 'THU', start: '19:00', end: '23:00' }],
      exceptions: [],
    }
    // 20:00 BA (UTC-3) == 23:00 UTC jueves.
    const now = new Date('2026-05-07T23:00:00Z')
    const win = currentOpeningWindow(hours, now)
    expect(win).not.toBeNull()
    // 19:00 BA == 22:00 UTC del mismo día.
    expect(win!.start.toISOString()).toBe('2026-05-07T22:00:00.000Z')
    // 23:00 BA == 02:00 UTC del viernes.
    expect(win!.end.toISOString()).toBe('2026-05-08T02:00:00.000Z')
  })
})

describe('currentOpeningWindow — entre dos ventanas mismo día', () => {
  it('lunes 13:00 BA con 07-11 y 15-20 → null (está entre ambas)', () => {
    const hours: OpeningHours = {
      kind: 'scheduled',
      timezone: BA,
      recurring: [
        { day: 'MON', start: '07:00', end: '11:00' },
        { day: 'MON', start: '15:00', end: '20:00' },
      ],
      exceptions: [],
    }
    // 13:00 BA == 16:00 UTC.
    const now = new Date('2026-05-04T16:00:00Z')
    expect(currentOpeningWindow(hours, now)).toBeNull()
  })
})

describe('currentOpeningWindow — excepciones', () => {
  it('excepción closed el mismo día que el recurring → null', () => {
    const hours: OpeningHours = {
      kind: 'scheduled',
      timezone: BA,
      recurring: [{ day: 'FRI', start: '09:00', end: '18:00' }],
      exceptions: [{ date: '2026-12-25', closed: true }],
    }
    // 25 dic 2026 es viernes. 12:00 BA == 15:00 UTC.
    const now = new Date('2026-12-25T15:00:00Z')
    expect(currentOpeningWindow(hours, now)).toBeNull()
  })

  it('excepción open en día sin recurring → ventana de la excepción', () => {
    const hours: OpeningHours = {
      kind: 'scheduled',
      timezone: BA,
      recurring: [{ day: 'FRI', start: '09:00', end: '18:00' }],
      exceptions: [{ date: '2026-04-25', windows: [{ start: '10:00', end: '17:00' }] }],
    }
    // Sábado 25 abril, 13:00 BA == 16:00 UTC.
    const now = new Date('2026-04-25T16:00:00Z')
    const win = currentOpeningWindow(hours, now)
    expect(win).not.toBeNull()
    // 10:00 BA == 13:00 UTC.
    expect(win!.start.toISOString()).toBe('2026-04-25T13:00:00.000Z')
    // 17:00 BA == 20:00 UTC.
    expect(win!.end.toISOString()).toBe('2026-04-25T20:00:00.000Z')
  })
})

describe('currentOpeningWindow — DST awareness', () => {
  it('Madrid post spring-forward: ventana MON 09-12 el lunes siguiente → horas locales preservadas', () => {
    // 2026-03-29 Madrid adelanta de 02:00 a 03:00 (CET→CEST, UTC+1→UTC+2).
    // Lunes 2026-03-30 11:00 Madrid == 09:00 UTC (ya en CEST).
    const hours: OpeningHours = {
      kind: 'scheduled',
      timezone: MAD,
      recurring: [{ day: 'MON', start: '09:00', end: '12:00' }],
      exceptions: [],
    }
    const now = new Date('2026-03-30T09:00:00Z')
    const win = currentOpeningWindow(hours, now)
    expect(win).not.toBeNull()
    // 09:00 Madrid (CEST) == 07:00 UTC.
    expect(win!.start.toISOString()).toBe('2026-03-30T07:00:00.000Z')
    // 12:00 Madrid (CEST) == 10:00 UTC.
    expect(win!.end.toISOString()).toBe('2026-03-30T10:00:00.000Z')
  })
})

describe('currentOpeningWindow — timezone BA happy path', () => {
  it('jueves 20:00 BA con ventana THU 19-23 retorna los instants correctos', () => {
    const hours: OpeningHours = {
      kind: 'scheduled',
      timezone: BA,
      recurring: [{ day: 'THU', start: '19:00', end: '23:00' }],
      exceptions: [],
    }
    const now = new Date('2026-05-07T23:00:00Z') // THU 20:00 BA
    const win = currentOpeningWindow(hours, now)
    expect(win).not.toBeNull()
    expect(win!.start.getTime()).toBeLessThan(now.getTime())
    expect(win!.end.getTime()).toBeGreaterThan(now.getTime())
  })
})
