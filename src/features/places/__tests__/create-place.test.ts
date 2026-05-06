import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { AuthorizationError, ConflictError, ValidationError } from '@/shared/errors/domain-error'

const placeFindUnique = vi.fn()
const placeCreate = vi.fn()
const ownershipCreate = vi.fn()
const membershipCreate = vi.fn()
const permissionGroupCreate = vi.fn()
const groupMembershipCreate = vi.fn()
const transactionFn = vi.fn()
const getUserFn = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    place: {
      findUnique: (...args: unknown[]) => placeFindUnique(...args),
      create: (...args: unknown[]) => placeCreate(...args),
    },
    placeOwnership: {
      create: (...args: unknown[]) => ownershipCreate(...args),
    },
    membership: {
      create: (...args: unknown[]) => membershipCreate(...args),
    },
    permissionGroup: {
      create: (...args: unknown[]) => permissionGroupCreate(...args),
    },
    groupMembership: {
      create: (...args: unknown[]) => groupMembershipCreate(...args),
    },
    $transaction: (fn: (tx: unknown) => unknown) => transactionFn(fn),
  },
}))

vi.mock('@/shared/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getUser: getUserFn },
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathFn(...args),
  // Plan #2.3: createPlaceAction invalida findMemberPermissions del creator.
  unstable_cache: <T extends (...args: never[]) => Promise<unknown>>(fn: T): T => fn,
  revalidateTag: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/shared/config/env', () => ({
  clientEnv: {
    NEXT_PUBLIC_APP_URL: 'http://lvh.me:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000',
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  },
  serverEnv: { SUPABASE_SERVICE_ROLE_KEY: 'service', NODE_ENV: 'test' },
}))

import { createPlaceAction } from '../server/actions'

const validInput = {
  slug: 'my-place',
  name: 'My Place',
  billingMode: 'OWNER_PAYS' as const,
}

const AUTH_OK = { data: { user: { id: 'user-1' } } }
const AUTH_NONE = { data: { user: null } }

beforeEach(() => {
  placeFindUnique.mockReset()
  placeCreate.mockReset()
  ownershipCreate.mockReset()
  membershipCreate.mockReset()
  permissionGroupCreate.mockReset()
  groupMembershipCreate.mockReset()
  transactionFn.mockReset()
  getUserFn.mockReset()
  revalidatePathFn.mockReset()

  // Default mock for the preset PermissionGroup insert; tests that need a
  // distinct id can override per-call.
  permissionGroupCreate.mockResolvedValue({ id: 'group-preset-1' })
  groupMembershipCreate.mockResolvedValue({})

  // Default: runs the inner transaction callback against a tx proxy.
  transactionFn.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({
      place: { create: placeCreate },
      placeOwnership: { create: ownershipCreate },
      membership: { create: membershipCreate },
      permissionGroup: { create: permissionGroupCreate },
      groupMembership: { create: groupMembershipCreate },
    }),
  )
})

describe('createPlaceAction', () => {
  it('rechaza input inválido con ValidationError', async () => {
    await expect(
      createPlaceAction({ slug: 'AB', name: '', billingMode: 'OWNER_PAYS' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(placeFindUnique).not.toHaveBeenCalled()
  })

  it('rechaza slug reservado con ValidationError', async () => {
    await expect(createPlaceAction({ ...validInput, slug: 'app' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(placeFindUnique).not.toHaveBeenCalled()
  })

  it('rechaza si no hay sesión con AuthorizationError', async () => {
    getUserFn.mockResolvedValue(AUTH_NONE)
    await expect(createPlaceAction(validInput)).rejects.toBeInstanceOf(AuthorizationError)
    expect(placeFindUnique).not.toHaveBeenCalled()
  })

  it('rechaza slug ya tomado (pre-check) con ConflictError', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue({ id: 'existing', slug: 'my-place' })

    await expect(createPlaceAction(validInput)).rejects.toBeInstanceOf(ConflictError)
    expect(transactionFn).not.toHaveBeenCalled()
  })

  it('mapea Prisma P2002 a ConflictError (race)', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(null)
    placeCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique violation', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    )

    await expect(createPlaceAction(validInput)).rejects.toBeInstanceOf(ConflictError)
  })

  it('happy path: crea Place + PlaceOwnership + Membership + preset PermissionGroup + GroupMembership en transacción', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(null)
    placeCreate.mockResolvedValue({ id: 'place-1', slug: 'my-place' })
    ownershipCreate.mockResolvedValue({})
    membershipCreate.mockResolvedValue({})
    permissionGroupCreate.mockResolvedValue({ id: 'group-preset-1' })
    groupMembershipCreate.mockResolvedValue({})

    const res = await createPlaceAction(validInput)

    expect(res).toEqual({ ok: true, place: { id: 'place-1', slug: 'my-place' } })
    expect(transactionFn).toHaveBeenCalledTimes(1)

    expect(placeCreate).toHaveBeenCalledWith({
      data: {
        slug: 'my-place',
        name: 'My Place',
        description: null,
        billingMode: 'OWNER_PAYS',
      },
      select: { id: true, slug: true },
    })
    expect(ownershipCreate).toHaveBeenCalledWith({
      data: { userId: 'user-1', placeId: 'place-1' },
    })
    expect(membershipCreate).toHaveBeenCalledWith({
      data: { userId: 'user-1', placeId: 'place-1' },
    })
    expect(permissionGroupCreate).toHaveBeenCalledTimes(1)
    expect(permissionGroupCreate.mock.calls[0]?.[0]).toMatchObject({
      data: expect.objectContaining({
        placeId: 'place-1',
        isPreset: true,
      }),
      select: { id: true },
    })
    expect(groupMembershipCreate).toHaveBeenCalledWith({
      data: { userId: 'user-1', placeId: 'place-1', groupId: 'group-preset-1' },
    })
    expect(revalidatePathFn).toHaveBeenCalledWith('/inbox')
  })

  it('multi-place: el mismo actor puede crear N places sin límite', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(null)

    placeCreate
      .mockResolvedValueOnce({ id: 'place-1', slug: 'place-uno' })
      .mockResolvedValueOnce({ id: 'place-2', slug: 'place-dos' })

    const first = await createPlaceAction({ ...validInput, slug: 'place-uno' })
    const second = await createPlaceAction({ ...validInput, slug: 'place-dos' })

    expect(first.place.id).toBe('place-1')
    expect(second.place.id).toBe('place-2')
    expect(transactionFn).toHaveBeenCalledTimes(2)
    expect(ownershipCreate).toHaveBeenCalledTimes(2)
    expect(membershipCreate).toHaveBeenCalledTimes(2)
    expect(permissionGroupCreate).toHaveBeenCalledTimes(2)
    expect(groupMembershipCreate).toHaveBeenCalledTimes(2)
  })
})
