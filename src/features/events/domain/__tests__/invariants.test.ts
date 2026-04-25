import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '@/shared/errors/domain-error'

// Mock hours/public para evitar la cadena server-only → supabase env (mismo
// patrón que comments-actions.test.ts y otros tests de discussions). Sólo
// usamos `isAllowedTimezone`, que es puro.
vi.mock('@/features/hours/public', () => ({
  isAllowedTimezone: (tz: string) =>
    [
      'UTC',
      'America/Argentina/Buenos_Aires',
      'America/Montevideo',
      'America/Santiago',
      'America/Sao_Paulo',
      'America/Bogota',
      'America/Lima',
      'America/Mexico_City',
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'Europe/Madrid',
      'Europe/London',
      'Europe/Paris',
      'Europe/Berlin',
      'Europe/Rome',
      'Africa/Johannesburg',
      'Asia/Tokyo',
      'Asia/Singapore',
      'Australia/Sydney',
    ].includes(tz),
}))
import {
  EVENT_MAX_DURATION_MS,
  EVENT_RSVP_NOTE_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
  EVENT_TITLE_MIN_LENGTH,
  normalizeRsvpNote,
  validateEventLocation,
  validateEventTimes,
  validateEventTimezone,
  validateEventTitle,
  validateRsvpNote,
} from '../invariants'

describe('validateEventTitle', () => {
  it('rechaza títulos < 3 chars', () => {
    expect(() => validateEventTitle('Hi')).toThrow(ValidationError)
    expect(() => validateEventTitle('Hi')).toThrow(/al menos 3/)
  })

  it('rechaza títulos > 120 chars', () => {
    expect(() => validateEventTitle('a'.repeat(EVENT_TITLE_MAX_LENGTH + 1))).toThrow(
      ValidationError,
    )
  })

  it('acepta títulos en el rango', () => {
    expect(() => validateEventTitle('a'.repeat(EVENT_TITLE_MIN_LENGTH))).not.toThrow()
    expect(() => validateEventTitle('Asado del viernes')).not.toThrow()
    expect(() => validateEventTitle('a'.repeat(EVENT_TITLE_MAX_LENGTH))).not.toThrow()
  })

  it('valida después de trim — espacios no cuentan', () => {
    expect(() => validateEventTitle('  Hi  ')).toThrow(ValidationError)
  })
})

describe('validateEventTimes', () => {
  const now = new Date('2026-04-25T20:00:00Z')

  it('rechaza endsAt <= startsAt', () => {
    expect(() =>
      validateEventTimes(
        {
          startsAt: new Date('2026-05-01T20:00:00Z'),
          endsAt: new Date('2026-05-01T19:59:59Z'),
        },
        now,
      ),
    ).toThrow(/posterior/)

    expect(() =>
      validateEventTimes(
        {
          startsAt: new Date('2026-05-01T20:00:00Z'),
          endsAt: new Date('2026-05-01T20:00:00Z'),
        },
        now,
      ),
    ).toThrow(/posterior/)
  })

  it('rechaza duración > 7 días', () => {
    expect(() =>
      validateEventTimes(
        {
          startsAt: new Date('2026-05-01T20:00:00Z'),
          endsAt: new Date(new Date('2026-05-01T20:00:00Z').getTime() + EVENT_MAX_DURATION_MS + 1),
        },
        now,
      ),
    ).toThrow(/7 días/)
  })

  it('rechaza startsAt <= now en create (requireFuture: true)', () => {
    expect(() =>
      validateEventTimes({ startsAt: new Date('2026-04-25T19:59:59Z'), endsAt: null }, now),
    ).toThrow(/futuro/)
  })

  it('permite startsAt <= now en update (requireFuture: false)', () => {
    expect(() =>
      validateEventTimes({ startsAt: new Date('2026-04-25T19:00:00Z'), endsAt: null }, now, {
        requireFuture: false,
      }),
    ).not.toThrow()
  })

  it('acepta endsAt null', () => {
    expect(() =>
      validateEventTimes({ startsAt: new Date('2026-05-01T20:00:00Z'), endsAt: null }, now),
    ).not.toThrow()
  })
})

describe('validateEventTimezone', () => {
  it('rechaza timezones fuera de la whitelist', () => {
    expect(() => validateEventTimezone('Antarctica/Troll')).toThrow(ValidationError)
    expect(() => validateEventTimezone('Argentina/Buenos_Aires')).toThrow(ValidationError) // sin America/
  })

  it('acepta timezones IANA permitidos', () => {
    expect(() => validateEventTimezone('America/Argentina/Buenos_Aires')).not.toThrow()
    expect(() => validateEventTimezone('Europe/Madrid')).not.toThrow()
    expect(() => validateEventTimezone('UTC')).not.toThrow()
  })
})

describe('validateEventLocation', () => {
  it('acepta null/undefined', () => {
    expect(() => validateEventLocation(null)).not.toThrow()
    expect(() => validateEventLocation(undefined)).not.toThrow()
  })

  it('rechaza > 200 chars', () => {
    expect(() => validateEventLocation('a'.repeat(201))).toThrow(/200/)
  })
})

describe('validateRsvpNote', () => {
  it('rechaza note en GOING', () => {
    expect(() => validateRsvpNote('GOING', 'random text')).toThrow(/sólo aplica/)
  })

  it('rechaza note en NOT_GOING', () => {
    expect(() => validateRsvpNote('NOT_GOING', 'random text')).toThrow(/sólo aplica/)
  })

  it('acepta note en GOING_CONDITIONAL', () => {
    expect(() => validateRsvpNote('GOING_CONDITIONAL', 'si llego del trabajo')).not.toThrow()
  })

  it('acepta note en NOT_GOING_CONTRIBUTING', () => {
    expect(() => validateRsvpNote('NOT_GOING_CONTRIBUTING', 'llevo el vino')).not.toThrow()
  })

  it('acepta null/empty siempre', () => {
    expect(() => validateRsvpNote('GOING', null)).not.toThrow()
    expect(() => validateRsvpNote('GOING', '')).not.toThrow()
    expect(() => validateRsvpNote('NOT_GOING_CONTRIBUTING', null)).not.toThrow()
  })

  it('rechaza note > 280 chars en condicionales', () => {
    expect(() =>
      validateRsvpNote('GOING_CONDITIONAL', 'a'.repeat(EVENT_RSVP_NOTE_MAX_LENGTH + 1)),
    ).toThrow(/280/)
  })
})

describe('normalizeRsvpNote', () => {
  it('descarta note en GOING/NOT_GOING aunque venga texto', () => {
    expect(normalizeRsvpNote('GOING', 'spurious')).toBeNull()
    expect(normalizeRsvpNote('NOT_GOING', 'spurious')).toBeNull()
  })

  it('preserva note trimmeado en condicionales', () => {
    expect(normalizeRsvpNote('GOING_CONDITIONAL', '  si llego  ')).toBe('si llego')
    expect(normalizeRsvpNote('NOT_GOING_CONTRIBUTING', 'llevo el vino')).toBe('llevo el vino')
  })

  it('null/empty se mapea a null en condicionales', () => {
    expect(normalizeRsvpNote('GOING_CONDITIONAL', null)).toBeNull()
    expect(normalizeRsvpNote('GOING_CONDITIONAL', '   ')).toBeNull()
  })
})
