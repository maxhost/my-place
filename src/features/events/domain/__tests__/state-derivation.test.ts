import { describe, expect, it } from 'vitest'
import { DEFAULT_EVENT_DURATION_MS, deriveEventState } from '../state-derivation'

const HOUR_MS = 60 * 60 * 1000

describe('deriveEventState', () => {
  const now = new Date('2026-04-25T20:00:00Z')

  it('retorna `cancelled` si `cancelledAt` está set (prevalece sobre cualquier otro)', () => {
    const upcomingCancelled = deriveEventState(
      {
        startsAt: new Date('2026-05-01T20:00:00Z'),
        endsAt: null,
        cancelledAt: new Date('2026-04-25T19:00:00Z'),
      },
      now,
    )
    expect(upcomingCancelled).toBe('cancelled')

    const pastCancelled = deriveEventState(
      {
        startsAt: new Date('2026-04-20T20:00:00Z'),
        endsAt: new Date('2026-04-20T22:00:00Z'),
        cancelledAt: new Date('2026-04-19T19:00:00Z'),
      },
      now,
    )
    expect(pastCancelled).toBe('cancelled')
  })

  it('retorna `upcoming` si `now < startsAt` (sin buffer pre-startsAt)', () => {
    expect(
      deriveEventState(
        {
          startsAt: new Date('2026-04-25T20:00:01Z'),
          endsAt: null,
          cancelledAt: null,
        },
        now,
      ),
    ).toBe('upcoming')

    expect(
      deriveEventState(
        { startsAt: new Date('2026-05-10T10:00:00Z'), endsAt: null, cancelledAt: null },
        now,
      ),
    ).toBe('upcoming')
  })

  it('retorna `happening` si `startsAt <= now < endsAt`', () => {
    expect(
      deriveEventState(
        {
          startsAt: new Date('2026-04-25T19:00:00Z'),
          endsAt: new Date('2026-04-25T22:00:00Z'),
          cancelledAt: null,
        },
        now,
      ),
    ).toBe('happening')

    // Borde exacto: startsAt = now → happening (no upcoming).
    expect(
      deriveEventState(
        {
          startsAt: new Date('2026-04-25T20:00:00Z'),
          endsAt: new Date('2026-04-25T22:00:00Z'),
          cancelledAt: null,
        },
        now,
      ),
    ).toBe('happening')
  })

  it('aplica default 2h cuando `endsAt` es null', () => {
    // startsAt 1h atrás, endsAt null → effectiveEnd = startsAt + 2h → 1h en el
    // futuro → still happening.
    expect(
      deriveEventState(
        {
          startsAt: new Date(now.getTime() - HOUR_MS),
          endsAt: null,
          cancelledAt: null,
        },
        now,
      ),
    ).toBe('happening')

    // startsAt 3h atrás, endsAt null → effectiveEnd = startsAt + 2h → 1h en
    // pasado → past.
    expect(
      deriveEventState(
        {
          startsAt: new Date(now.getTime() - 3 * HOUR_MS),
          endsAt: null,
          cancelledAt: null,
        },
        now,
      ),
    ).toBe('past')

    // Edge exacto: startsAt = now - 2h sin endsAt → effectiveEnd = now → past.
    expect(
      deriveEventState(
        {
          startsAt: new Date(now.getTime() - DEFAULT_EVENT_DURATION_MS),
          endsAt: null,
          cancelledAt: null,
        },
        now,
      ),
    ).toBe('past')
  })

  it('retorna `past` si `now >= endsAt`', () => {
    expect(
      deriveEventState(
        {
          startsAt: new Date('2026-04-25T18:00:00Z'),
          endsAt: new Date('2026-04-25T19:00:00Z'),
          cancelledAt: null,
        },
        now,
      ),
    ).toBe('past')

    // endsAt = now exact → past.
    expect(
      deriveEventState(
        {
          startsAt: new Date('2026-04-25T18:00:00Z'),
          endsAt: new Date('2026-04-25T20:00:00Z'),
          cancelledAt: null,
        },
        now,
      ),
    ).toBe('past')
  })
})
