import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  AuthorizationError,
  ConflictError,
  InvariantViolation,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'

const placeFindUnique = vi.fn()
const ownershipFindUniqueTop = vi.fn()
const queryRawTx = vi.fn()
const membershipFindFirstTx = vi.fn()
const ownershipUpsertTx = vi.fn()
const ownershipDeleteTx = vi.fn()
const ownershipCountTx = vi.fn()
const membershipUpdateManyTx = vi.fn()
const transactionFn = vi.fn()
const getUserFn = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    place: {
      findUnique: (...a: unknown[]) => placeFindUnique(...a),
    },
    placeOwnership: {
      findUnique: (...a: unknown[]) => ownershipFindUniqueTop(...a),
    },
    $transaction: (fn: (tx: unknown) => unknown) => transactionFn(fn),
  },
}))

vi.mock('@/shared/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: getUserFn } }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
  // Plan #2.3: transferOwnershipAction invalida findMemberPermissions de
  // ambos lados (actor y target).
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

import { transferOwnershipAction } from '../server/actions'

const AUTH_OK = { data: { user: { id: 'user-A' } } }
const AUTH_NONE = { data: { user: null } }

const VALID_INPUT = {
  placeSlug: 'the-company',
  toUserId: 'user-B',
  removeActor: false,
}

function makePlace(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'place-1',
    slug: 'the-company',
    name: 'The Company',
    description: null,
    billingMode: 'OWNER_PAYS' as const,
    archivedAt: null,
    createdAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  placeFindUnique.mockReset()
  ownershipFindUniqueTop.mockReset()
  queryRawTx.mockReset()
  membershipFindFirstTx.mockReset()
  ownershipUpsertTx.mockReset()
  ownershipDeleteTx.mockReset()
  ownershipCountTx.mockReset()
  membershipUpdateManyTx.mockReset()
  transactionFn.mockReset()
  getUserFn.mockReset()
  revalidatePathFn.mockReset()

  queryRawTx.mockResolvedValue([])
  transactionFn.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({
      $queryRaw: queryRawTx,
      membership: {
        findFirst: membershipFindFirstTx,
        updateMany: membershipUpdateManyTx,
      },
      placeOwnership: {
        upsert: ownershipUpsertTx,
        delete: ownershipDeleteTx,
        count: ownershipCountTx,
      },
    }),
  )
})

describe('transferOwnershipAction', () => {
  it('rechaza input inválido con ValidationError', async () => {
    await expect(transferOwnershipAction({ placeSlug: '', toUserId: '' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('rechaza sin sesión con AuthorizationError', async () => {
    getUserFn.mockResolvedValue(AUTH_NONE)
    await expect(transferOwnershipAction(VALID_INPUT)).rejects.toBeInstanceOf(AuthorizationError)
  })

  it('transfer a uno mismo → ValidationError self_transfer', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    await expect(
      transferOwnershipAction({ ...VALID_INPUT, toUserId: 'user-A' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      context: expect.objectContaining({ reason: 'self_transfer' }),
    })
    expect(placeFindUnique).not.toHaveBeenCalled()
  })

  it('place inexistente → NotFoundError', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(null)
    await expect(transferOwnershipAction(VALID_INPUT)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('place archivado → ConflictError', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(makePlace({ archivedAt: new Date() }))
    await expect(transferOwnershipAction(VALID_INPUT)).rejects.toBeInstanceOf(ConflictError)
  })

  it('actor no es owner → AuthorizationError', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(makePlace())
    ownershipFindUniqueTop.mockResolvedValue(null)
    await expect(transferOwnershipAction(VALID_INPUT)).rejects.toBeInstanceOf(AuthorizationError)
    expect(transactionFn).not.toHaveBeenCalled()
  })

  it('target no es miembro activo → ValidationError target_not_member', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(makePlace())
    ownershipFindUniqueTop.mockResolvedValue({ userId: 'user-A', placeId: 'place-1' })
    membershipFindFirstTx.mockResolvedValue(null)

    await expect(transferOwnershipAction(VALID_INPUT)).rejects.toMatchObject({
      code: 'VALIDATION',
      context: expect.objectContaining({ reason: 'target_not_member' }),
    })
    expect(ownershipUpsertTx).not.toHaveBeenCalled()
  })

  it('happy path removeActor=false: upsert target, NO toca actor', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(makePlace())
    ownershipFindUniqueTop.mockResolvedValue({ userId: 'user-A', placeId: 'place-1' })
    membershipFindFirstTx.mockResolvedValue({ id: 'mem-B' })
    ownershipUpsertTx.mockResolvedValue({})
    ownershipCountTx.mockResolvedValue(2) // actor + target

    const res = await transferOwnershipAction(VALID_INPUT)
    expect(res).toEqual({ ok: true, placeSlug: 'the-company', actorRemoved: false })
    expect(ownershipUpsertTx).toHaveBeenCalledWith({
      where: { userId_placeId: { userId: 'user-B', placeId: 'place-1' } },
      create: { userId: 'user-B', placeId: 'place-1' },
      update: {},
    })
    expect(ownershipDeleteTx).not.toHaveBeenCalled()
    expect(membershipUpdateManyTx).not.toHaveBeenCalled()
  })

  it('happy path removeActor=true: actor sale (ownership + leftAt)', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(makePlace())
    ownershipFindUniqueTop.mockResolvedValue({ userId: 'user-A', placeId: 'place-1' })
    membershipFindFirstTx.mockResolvedValue({ id: 'mem-B' })
    ownershipUpsertTx.mockResolvedValue({})
    ownershipDeleteTx.mockResolvedValue({})
    membershipUpdateManyTx.mockResolvedValue({ count: 1 })
    ownershipCountTx.mockResolvedValue(1) // solo target queda

    const res = await transferOwnershipAction({ ...VALID_INPUT, removeActor: true })
    expect(res.actorRemoved).toBe(true)
    expect(ownershipDeleteTx).toHaveBeenCalledWith({
      where: { userId_placeId: { userId: 'user-A', placeId: 'place-1' } },
    })
    expect(membershipUpdateManyTx).toHaveBeenCalledWith({
      where: { userId: 'user-A', placeId: 'place-1', leftAt: null },
      data: { leftAt: expect.any(Date) },
    })
  })

  it('invariante: count post-operación = 0 → InvariantViolation', async () => {
    // Caso defensivo: si el count queda en 0 (corrupción concurrente), rollback.
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(makePlace())
    ownershipFindUniqueTop.mockResolvedValue({ userId: 'user-A', placeId: 'place-1' })
    membershipFindFirstTx.mockResolvedValue({ id: 'mem-B' })
    ownershipUpsertTx.mockResolvedValue({})
    ownershipDeleteTx.mockResolvedValue({})
    membershipUpdateManyTx.mockResolvedValue({ count: 1 })
    ownershipCountTx.mockResolvedValue(0) // estado corrupto

    await expect(
      transferOwnershipAction({ ...VALID_INPUT, removeActor: true }),
    ).rejects.toBeInstanceOf(InvariantViolation)
  })

  it('multi-place: solo escribe filas del place objetivo', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(makePlace())
    ownershipFindUniqueTop.mockResolvedValue({ userId: 'user-A', placeId: 'place-1' })
    membershipFindFirstTx.mockResolvedValue({ id: 'mem-B' })
    ownershipUpsertTx.mockResolvedValue({})
    ownershipCountTx.mockResolvedValue(2)

    await transferOwnershipAction(VALID_INPUT)

    expect(membershipFindFirstTx).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-B', placeId: 'place-1', leftAt: null }),
      }),
    )
    expect(ownershipUpsertTx).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_placeId: { userId: 'user-B', placeId: 'place-1' } },
      }),
    )
    expect(ownershipCountTx).toHaveBeenCalledWith({ where: { placeId: 'place-1' } })
  })

  it('target que también es owner de otro place → transfer OK (ortogonal)', async () => {
    // El estado del target en otros places es irrelevante para este transfer.
    // Como mockeamos solo el place-1, implícitamente el test confirma que no
    // se consultan otros placeIds (todas las consultas filtran por placeId=place-1).
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(makePlace())
    ownershipFindUniqueTop.mockResolvedValue({ userId: 'user-A', placeId: 'place-1' })
    membershipFindFirstTx.mockResolvedValue({ id: 'mem-B' })
    ownershipUpsertTx.mockResolvedValue({})
    ownershipCountTx.mockResolvedValue(2)

    const res = await transferOwnershipAction(VALID_INPUT)
    expect(res.ok).toBe(true)
  })
})
