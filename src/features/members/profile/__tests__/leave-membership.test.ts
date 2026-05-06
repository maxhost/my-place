import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  AuthorizationError,
  ConflictError,
  InvariantViolation,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'

const placeFindUnique = vi.fn()
const membershipFindFirstTop = vi.fn() // findActiveMembership (outside tx)
const queryRawTx = vi.fn()
const ownershipFindManyTx = vi.fn()
const ownershipDeleteTx = vi.fn()
const membershipUpdateTx = vi.fn()
const transactionFn = vi.fn()
const getUserFn = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    place: {
      findUnique: (...a: unknown[]) => placeFindUnique(...a),
    },
    membership: {
      findFirst: (...a: unknown[]) => membershipFindFirstTop(...a),
    },
    $transaction: (fn: (tx: unknown) => unknown) => transactionFn(fn),
  },
}))

vi.mock('@/shared/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: getUserFn } }),
}))

vi.mock('@/shared/lib/supabase/admin', () => ({
  createSupabaseAdmin: () => ({ auth: { admin: { inviteUserByEmail: vi.fn() } } }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
  // Plan #2.3: el action invalida `findMemberPermissions` via revalidateTag.
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
  serverEnv: { SUPABASE_SERVICE_ROLE_KEY: 'service' },
}))

import { leaveMembershipAction } from '@/features/members/profile/server/actions/leave'

const AUTH_OK = { data: { user: { id: 'user-1' } } }
const AUTH_NONE = { data: { user: null } }

function makePlace(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'place-1',
    slug: 'the-company',
    archivedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  placeFindUnique.mockReset()
  membershipFindFirstTop.mockReset()
  queryRawTx.mockReset()
  ownershipFindManyTx.mockReset()
  ownershipDeleteTx.mockReset()
  membershipUpdateTx.mockReset()
  transactionFn.mockReset()
  getUserFn.mockReset()
  revalidatePathFn.mockReset()

  queryRawTx.mockResolvedValue([])
  transactionFn.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({
      $queryRaw: queryRawTx,
      placeOwnership: {
        findMany: ownershipFindManyTx,
        delete: ownershipDeleteTx,
      },
      membership: {
        update: membershipUpdateTx,
      },
    }),
  )
})

describe('leaveMembershipAction', () => {
  it('rechaza slug no-string con ValidationError', async () => {
    await expect(leaveMembershipAction(undefined)).rejects.toBeInstanceOf(ValidationError)
    await expect(leaveMembershipAction('')).rejects.toBeInstanceOf(ValidationError)
  })

  it('rechaza sin sesión con AuthorizationError', async () => {
    getUserFn.mockResolvedValue(AUTH_NONE)
    await expect(leaveMembershipAction('the-company')).rejects.toBeInstanceOf(AuthorizationError)
    expect(placeFindUnique).not.toHaveBeenCalled()
  })

  it('place inexistente → NotFoundError', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(null)
    await expect(leaveMembershipAction('the-company')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('place archivado → ConflictError', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(makePlace({ archivedAt: new Date() }))
    await expect(leaveMembershipAction('the-company')).rejects.toBeInstanceOf(ConflictError)
  })

  it('no es miembro activo → NotFoundError', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(makePlace())
    membershipFindFirstTop.mockResolvedValue(null)
    await expect(leaveMembershipAction('the-company')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(transactionFn).not.toHaveBeenCalled()
  })

  it('único owner → InvariantViolation last_owner', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(makePlace())
    membershipFindFirstTop.mockResolvedValue({ id: 'mem-1' })
    ownershipFindManyTx.mockResolvedValue([{ userId: 'user-1' }])

    await expect(leaveMembershipAction('the-company')).rejects.toBeInstanceOf(InvariantViolation)
    expect(ownershipDeleteTx).not.toHaveBeenCalled()
    expect(membershipUpdateTx).not.toHaveBeenCalled()
  })

  it('happy path no-owner: setea leftAt, no toca ownership', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(makePlace())
    membershipFindFirstTop.mockResolvedValue({ id: 'mem-1' })
    ownershipFindManyTx.mockResolvedValue([{ userId: 'other-owner' }])
    membershipUpdateTx.mockResolvedValue({})

    const res = await leaveMembershipAction('the-company')
    expect(res).toEqual({ ok: true, placeSlug: 'the-company' })
    expect(ownershipDeleteTx).not.toHaveBeenCalled()
    expect(membershipUpdateTx).toHaveBeenCalledWith({
      where: { id: 'mem-1' },
      data: { leftAt: expect.any(Date) },
    })
    // Invalida el subtree del layout `[placeSlug]` para que el TopBar trigger
    // y settings nav desaparezcan en tabs abiertos del actor.
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-company', 'layout')
  })

  it('happy path owner con otros owners: remueve su ownership y setea leftAt', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(makePlace())
    membershipFindFirstTop.mockResolvedValue({ id: 'mem-1' })
    ownershipFindManyTx.mockResolvedValue([{ userId: 'user-1' }, { userId: 'other-owner' }])
    ownershipDeleteTx.mockResolvedValue({})
    membershipUpdateTx.mockResolvedValue({})

    const res = await leaveMembershipAction('the-company')
    expect(res).toEqual({ ok: true, placeSlug: 'the-company' })
    expect(ownershipDeleteTx).toHaveBeenCalledWith({
      where: { userId_placeId: { userId: 'user-1', placeId: 'place-1' } },
    })
    expect(membershipUpdateTx).toHaveBeenCalledWith({
      where: { id: 'mem-1' },
      data: { leftAt: expect.any(Date) },
    })
  })

  it('toma lock FOR UPDATE sobre PlaceOwnership antes de leer', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(makePlace())
    membershipFindFirstTop.mockResolvedValue({ id: 'mem-1' })
    ownershipFindManyTx.mockResolvedValue([{ userId: 'other-owner' }])
    membershipUpdateTx.mockResolvedValue({})

    await leaveMembershipAction('the-company')
    expect(queryRawTx).toHaveBeenCalled()
    // El lock se toma antes del findMany — no podemos verificar orden directo en vitest,
    // pero sí que ambas operaciones ocurrieron adentro de la tx.
    expect(ownershipFindManyTx).toHaveBeenCalledWith(
      expect.objectContaining({ where: { placeId: 'place-1' } }),
    )
  })

  it('multi-place: solo toca la membership del place objetivo', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(makePlace())
    membershipFindFirstTop.mockResolvedValue({ id: 'mem-1' })
    ownershipFindManyTx.mockResolvedValue([{ userId: 'other-owner' }])
    membershipUpdateTx.mockResolvedValue({})

    await leaveMembershipAction('the-company')

    // Todas las escrituras apuntan a place-1. Ningún otro placeId es referenciado.
    expect(membershipFindFirstTop).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1', placeId: 'place-1' }),
      }),
    )
    expect(ownershipFindManyTx).toHaveBeenCalledWith({
      where: { placeId: 'place-1' },
      select: { userId: true },
    })
  })
})
