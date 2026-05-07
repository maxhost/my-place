import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { NotFoundError, OutOfHoursError, ValidationError } from '@/shared/errors/domain-error'

const placeFindUnique = vi.fn()
const membershipFindFirst = vi.fn()
const ownershipFindUnique = vi.fn()
const userFindUnique = vi.fn()
const groupMembershipFindFirst = vi.fn()
const postFindUnique = vi.fn()
const commentFindUnique = vi.fn()
const reactionCreate = vi.fn()
const reactionDeleteMany = vi.fn()
const postReadQueryRaw = vi.fn()
const getUserFn = vi.fn()
const findPlaceHoursFn = vi.fn()
const currentOpeningWindowFn = vi.fn()
const assertPlaceOpenFn = vi.fn()
const revalidatePathFn = vi.fn()
const placeOpeningFindFirst = vi.fn()
const placeOpeningCreate = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
    membership: { findFirst: (...a: unknown[]) => membershipFindFirst(...a) },
    placeOwnership: { findUnique: (...a: unknown[]) => ownershipFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    groupMembership: {
      findFirst: (...a: unknown[]) => groupMembershipFindFirst(...a),
    },
    post: { findUnique: (...a: unknown[]) => postFindUnique(...a) },
    comment: { findUnique: (...a: unknown[]) => commentFindUnique(...a) },
    reaction: {
      create: (...a: unknown[]) => reactionCreate(...a),
      deleteMany: (...a: unknown[]) => reactionDeleteMany(...a),
    },
    $queryRaw: (...a: unknown[]) => postReadQueryRaw(...a),
    placeOpening: {
      findFirst: (...a: unknown[]) => placeOpeningFindFirst(...a),
      create: (...a: unknown[]) => placeOpeningCreate(...a),
    },
  },
}))

vi.mock('@/shared/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: getUserFn } }),
}))

vi.mock('@/features/hours/public.server', () => ({
  assertPlaceOpenOrThrow: (...a: unknown[]) => assertPlaceOpenFn(...a),
  findPlaceHours: (...a: unknown[]) => findPlaceHoursFn(...a),
}))

vi.mock('@/features/hours/public', () => ({
  assertPlaceOpenOrThrow: (...a: unknown[]) => assertPlaceOpenFn(...a),
  findPlaceHours: (...a: unknown[]) => findPlaceHoursFn(...a),
  currentOpeningWindow: (...a: unknown[]) => currentOpeningWindowFn(...a),
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
}))
vi.mock('server-only', () => ({}))

import { reactAction, unreactAction } from '../server/actions/reactions'
import { markPostReadAction } from '../server/actions/reads'

function mockActiveMember(opts: { asAdmin?: boolean } = {}): void {
  getUserFn.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  placeFindUnique.mockResolvedValue({ id: 'place-1', slug: 'the-place', archivedAt: null })
  membershipFindFirst.mockResolvedValue({ id: 'm-1' })
  ownershipFindUnique.mockResolvedValue(null)
  groupMembershipFindFirst.mockResolvedValue(opts.asAdmin ? { id: 'gm-mock' } : null)
  userFindUnique.mockResolvedValue({ displayName: 'Max', avatarUrl: null })
  assertPlaceOpenFn.mockResolvedValue(undefined)
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('reactAction', () => {
  it('happy path post: crea reacción', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      slug: 'tema-1',
      hiddenAt: null,
      deletedAt: null,
    })
    reactionCreate.mockResolvedValue({ id: 'r-1' })

    const result = await reactAction({
      targetType: 'POST',
      targetId: 'po-1',
      emoji: 'THUMBS_UP',
    })
    expect(result).toEqual({ ok: true, alreadyReacted: false })
  })

  it('P2002 ⇒ alreadyReacted:true (idempotente)', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      slug: 'tema-1',
      hiddenAt: null,
      deletedAt: null,
    })
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: '5',
    })
    reactionCreate.mockRejectedValue(p2002)

    const result = await reactAction({
      targetType: 'POST',
      targetId: 'po-1',
      emoji: 'HEART',
    })
    expect(result).toEqual({ ok: true, alreadyReacted: true })
  })

  it('ValidationError si emoji fuera del set cerrado', async () => {
    await expect(
      reactAction({ targetType: 'POST', targetId: 'po-1', emoji: 'FIRE' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('NotFoundError si post no existe', async () => {
    postFindUnique.mockResolvedValue(null)
    await expect(
      reactAction({ targetType: 'POST', targetId: 'po-x', emoji: 'THUMBS_UP' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('unreactAction', () => {
  it('removed:true si existía', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      slug: 'tema-1',
      hiddenAt: null,
      deletedAt: null,
    })
    reactionDeleteMany.mockResolvedValue({ count: 1 })
    const result = await unreactAction({
      targetType: 'POST',
      targetId: 'po-1',
      emoji: 'THUMBS_UP',
    })
    expect(result).toEqual({ ok: true, removed: true })
  })

  it('removed:false si no existía', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      slug: 'tema-1',
      hiddenAt: null,
      deletedAt: null,
    })
    reactionDeleteMany.mockResolvedValue({ count: 0 })
    const result = await unreactAction({
      targetType: 'POST',
      targetId: 'po-1',
      emoji: 'THUMBS_UP',
    })
    expect(result).toEqual({ ok: true, removed: false })
  })
})

describe('markPostReadAction', () => {
  function mockPostAndOpening(): void {
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      slug: 'tema-1',
      hiddenAt: null,
      deletedAt: null,
    })
    findPlaceHoursFn.mockResolvedValue({ kind: 'always_open' })
    placeOpeningFindFirst.mockResolvedValue({
      id: 'op-1',
      startAt: new Date(),
      endAt: null,
    })
  }

  it('dwell <5s ⇒ recorded:false, no writes', async () => {
    const result = await markPostReadAction({ postId: 'po-1', dwellMs: 3000 })
    expect(result).toEqual({ ok: true, recorded: false })
    expect(postReadQueryRaw).not.toHaveBeenCalled()
  })

  it('primera lectura en la apertura ⇒ insert (recorded:true) via upsert', async () => {
    mockActiveMember()
    mockPostAndOpening()
    postReadQueryRaw.mockResolvedValue([{ inserted: true }])

    const result = await markPostReadAction({ postId: 'po-1', dwellMs: 6000 })
    expect(result).toEqual({ ok: true, recorded: true })
    expect(postReadQueryRaw).toHaveBeenCalledTimes(1)
  })

  it('re-lectura en la misma apertura ⇒ update (recorded:false) y sin errores', async () => {
    // Regresión del bug C.F.1: antes capturábamos P2002 y dejábamos `readAt` congelado.
    // Ahora el upsert actualiza `readAt = now()` y retorna recorded:false (update, no insert).
    mockActiveMember()
    mockPostAndOpening()
    postReadQueryRaw.mockResolvedValue([{ inserted: false }])

    const result = await markPostReadAction({ postId: 'po-1', dwellMs: 6000 })
    expect(result).toEqual({ ok: true, recorded: false })
    expect(postReadQueryRaw).toHaveBeenCalledTimes(1)
  })

  it('OutOfHoursError si no hay apertura activa', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      slug: 'tema-1',
      hiddenAt: null,
      deletedAt: null,
    })
    findPlaceHoursFn.mockResolvedValue({ kind: 'scheduled' })
    currentOpeningWindowFn.mockReturnValue(null)
    placeOpeningFindFirst.mockResolvedValue(null)

    await expect(markPostReadAction({ postId: 'po-1', dwellMs: 10_000 })).rejects.toBeInstanceOf(
      OutOfHoursError,
    )
    expect(postReadQueryRaw).not.toHaveBeenCalled()
  })

  it('primera lectura: revalida el path del thread para refrescar PostReadersBlock + dot', async () => {
    mockActiveMember()
    mockPostAndOpening()
    postReadQueryRaw.mockResolvedValue([{ inserted: true }])

    await markPostReadAction({ postId: 'po-1', dwellMs: 6000 })

    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/conversations/tema-1')
  })

  it('re-lectura también revalida (readAt avanza → altera orden del bloque + apaga dot)', async () => {
    mockActiveMember()
    mockPostAndOpening()
    postReadQueryRaw.mockResolvedValue([{ inserted: false }])

    await markPostReadAction({ postId: 'po-1', dwellMs: 6000 })

    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/conversations/tema-1')
  })
})
