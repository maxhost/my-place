import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

const placeFindUnique = vi.fn()
const placeUpdate = vi.fn()
const membershipFindFirst = vi.fn()
const ownershipFindUnique = vi.fn()
const getUserFn = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    place: {
      findUnique: (...a: unknown[]) => placeFindUnique(...a),
      update: (...a: unknown[]) => placeUpdate(...a),
    },
    membership: {
      findFirst: (...a: unknown[]) => membershipFindFirst(...a),
    },
    placeOwnership: {
      findUnique: (...a: unknown[]) => ownershipFindUnique(...a),
    },
  },
}))

vi.mock('@/shared/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: getUserFn } }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/shared/config/env', () => ({
  clientEnv: {
    NEXT_PUBLIC_APP_URL: 'http://lvh.me:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000',
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  },
  serverEnv: { SUPABASE_SERVICE_ROLE_KEY: 'service' },
}))

import { updatePlaceHoursAction } from '../server/actions'

const AUTH_OK = { data: { user: { id: 'user-1' } } }
const AUTH_NONE = { data: { user: null } }

const validInput = {
  placeSlug: 'the-company',
  timezone: 'America/Argentina/Buenos_Aires',
  recurring: [{ day: 'THU', start: '19:00', end: '23:00' }],
  exceptions: [],
}

beforeEach(() => {
  placeFindUnique.mockReset()
  placeUpdate.mockReset()
  membershipFindFirst.mockReset()
  ownershipFindUnique.mockReset()
  getUserFn.mockReset()
  revalidatePathFn.mockReset()
})

describe('updatePlaceHoursAction', () => {
  it('lanza AuthorizationError si no hay sesión', async () => {
    getUserFn.mockResolvedValue(AUTH_NONE)
    await expect(updatePlaceHoursAction(validInput)).rejects.toBeInstanceOf(AuthorizationError)
  })

  it('lanza ValidationError si el input es inválido (cross-midnight)', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    await expect(
      updatePlaceHoursAction({
        ...validInput,
        recurring: [{ day: 'SAT', start: '22:00', end: '01:00' }],
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('lanza ValidationError si el timezone no está en la allowlist', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    await expect(
      updatePlaceHoursAction({ ...validInput, timezone: 'Atlantis/Lost_City' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('lanza ValidationError si hay overlap en el mismo día', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    await expect(
      updatePlaceHoursAction({
        ...validInput,
        recurring: [
          { day: 'MON', start: '09:00', end: '12:00' },
          { day: 'MON', start: '11:00', end: '14:00' },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('lanza NotFoundError si el place no existe', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(null)
    await expect(updatePlaceHoursAction(validInput)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('lanza NotFoundError si el place está archivado', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue({
      id: 'place-1',
      slug: 'the-company',
      archivedAt: new Date(),
    })
    await expect(updatePlaceHoursAction(validInput)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('lanza AuthorizationError si el actor es member no-admin', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue({
      id: 'place-1',
      slug: 'the-company',
      archivedAt: null,
    })
    membershipFindFirst.mockResolvedValue({ role: 'MEMBER' })
    ownershipFindUnique.mockResolvedValue(null)
    await expect(updatePlaceHoursAction(validInput)).rejects.toBeInstanceOf(AuthorizationError)
  })

  it('happy path admin: persiste el JSON esperado y revalida el layout', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue({
      id: 'place-1',
      slug: 'the-company',
      archivedAt: null,
    })
    membershipFindFirst.mockResolvedValue({ role: 'ADMIN' })
    ownershipFindUnique.mockResolvedValue(null)
    placeUpdate.mockResolvedValue({})

    const res = await updatePlaceHoursAction(validInput)
    expect(res).toEqual({ ok: true })

    expect(placeUpdate).toHaveBeenCalledWith({
      where: { id: 'place-1' },
      data: {
        openingHours: {
          kind: 'scheduled',
          timezone: 'America/Argentina/Buenos_Aires',
          recurring: [{ day: 'THU', start: '19:00', end: '23:00' }],
          exceptions: [],
        },
      },
    })
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-company', 'layout')
  })

  it('happy path owner sin role ADMIN también pasa', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue({
      id: 'place-1',
      slug: 'the-company',
      archivedAt: null,
    })
    membershipFindFirst.mockResolvedValue({ role: 'MEMBER' })
    ownershipFindUnique.mockResolvedValue({ userId: 'user-1' })
    placeUpdate.mockResolvedValue({})

    await expect(updatePlaceHoursAction(validInput)).resolves.toEqual({ ok: true })
    expect(placeUpdate).toHaveBeenCalled()
  })

  it('admite excepciones (closed + windows) en el JSON persistido', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue({
      id: 'place-1',
      slug: 'the-company',
      archivedAt: null,
    })
    membershipFindFirst.mockResolvedValue({ role: 'ADMIN' })
    ownershipFindUnique.mockResolvedValue(null)
    placeUpdate.mockResolvedValue({})

    const input = {
      ...validInput,
      exceptions: [
        { date: '2026-12-25', closed: true as const },
        {
          date: '2026-04-29',
          windows: [{ start: '10:00', end: '17:00' }],
        },
      ],
    }
    await updatePlaceHoursAction(input)

    const call = placeUpdate.mock.calls[0]?.[0]
    expect(call?.data?.openingHours?.exceptions).toHaveLength(2)
  })
})
