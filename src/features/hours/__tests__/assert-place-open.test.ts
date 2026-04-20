import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OutOfHoursError } from '@/shared/errors/domain-error'

const placeFindUnique = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
  },
}))

vi.mock('server-only', () => ({}))

// React.cache memoiza por identidad de argumentos entre tests — invalidamos
// cambiando el `placeId` en cada caso para evitar colisiones de caché.
import { assertPlaceOpenOrThrow } from '../server/queries'

beforeEach(() => {
  placeFindUnique.mockReset()
})

describe('assertPlaceOpenOrThrow', () => {
  it('no lanza si el place está always_open', async () => {
    placeFindUnique.mockResolvedValue({
      openingHours: { kind: 'always_open', timezone: 'UTC' },
    })
    await expect(
      assertPlaceOpenOrThrow('always-open-place', new Date('2026-05-07T10:00:00Z')),
    ).resolves.toBeUndefined()
  })

  it('no lanza si el place está scheduled y dentro de ventana', async () => {
    placeFindUnique.mockResolvedValue({
      openingHours: {
        kind: 'scheduled',
        timezone: 'America/Argentina/Buenos_Aires',
        recurring: [{ day: 'THU', start: '19:00', end: '23:00' }],
        exceptions: [],
      },
    })
    // 20:00 BA = 23:00 UTC, jueves.
    await expect(
      assertPlaceOpenOrThrow('open-place', new Date('2026-05-07T23:00:00Z')),
    ).resolves.toBeUndefined()
  })

  it('lanza OutOfHoursError con opensAt si está cerrado por horario', async () => {
    placeFindUnique.mockResolvedValue({
      openingHours: {
        kind: 'scheduled',
        timezone: 'America/Argentina/Buenos_Aires',
        recurring: [{ day: 'THU', start: '19:00', end: '23:00' }],
        exceptions: [],
      },
    })
    // Viernes 10 BA = 13 UTC — cerrado, opensAt = jueves próximo 19 BA.
    await expect(
      assertPlaceOpenOrThrow('closed-place', new Date('2026-05-08T13:00:00Z')),
    ).rejects.toMatchObject({
      code: 'OUT_OF_HOURS',
      placeId: 'closed-place',
    })
  })

  it('lanza OutOfHoursError con opensAt null si está unconfigured', async () => {
    placeFindUnique.mockResolvedValue({ openingHours: {} })
    try {
      await assertPlaceOpenOrThrow('unconfigured-place', new Date('2026-05-07T10:00:00Z'))
      throw new Error('Expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(OutOfHoursError)
      if (err instanceof OutOfHoursError) {
        expect(err.placeId).toBe('unconfigured-place')
        expect(err.opensAt).toBeNull()
      }
    }
  })

  it('lanza OutOfHoursError si el place no existe (fallback a unconfigured)', async () => {
    placeFindUnique.mockResolvedValue(null)
    await expect(assertPlaceOpenOrThrow('missing-place', new Date())).rejects.toBeInstanceOf(
      OutOfHoursError,
    )
  })
})
