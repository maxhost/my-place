import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MembershipRole, Prisma } from '@prisma/client'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { FlagAlreadyExists } from '../domain/errors'

const placeFindUnique = vi.fn()
const membershipFindFirst = vi.fn()
const ownershipFindUnique = vi.fn()
const userFindUnique = vi.fn()
const postFindUnique = vi.fn()
const commentFindUnique = vi.fn()
const flagCreate = vi.fn()
const flagFindUnique = vi.fn()
const flagUpdateMany = vi.fn()
const postUpdate = vi.fn()
const commentUpdate = vi.fn()
const transactionFn = vi.fn()
const getUserFn = vi.fn()
const revalidatePathFn = vi.fn()
const hardDeletePostFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
    membership: { findFirst: (...a: unknown[]) => membershipFindFirst(...a) },
    placeOwnership: { findUnique: (...a: unknown[]) => ownershipFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    post: {
      findUnique: (...a: unknown[]) => postFindUnique(...a),
      update: (...a: unknown[]) => postUpdate(...a),
    },
    comment: {
      findUnique: (...a: unknown[]) => commentFindUnique(...a),
      update: (...a: unknown[]) => commentUpdate(...a),
    },
    flag: {
      create: (...a: unknown[]) => flagCreate(...a),
      findUnique: (...a: unknown[]) => flagFindUnique(...a),
      updateMany: (...a: unknown[]) => flagUpdateMany(...a),
    },
    $transaction: (...a: unknown[]) => transactionFn(...a),
  },
}))

vi.mock('@/shared/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: getUserFn } }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
}))
vi.mock('server-only', () => ({}))

vi.mock('@/features/discussions/public.server', () => ({
  hardDeletePost: (...a: unknown[]) => hardDeletePostFn(...a),
}))

import { flagAction, reviewFlagAction } from '../server/actions'

type TxArgs = Parameters<typeof transactionFn>[0]

function mockActiveMember(role: MembershipRole = MembershipRole.MEMBER): void {
  getUserFn.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  placeFindUnique.mockResolvedValue({
    id: 'place-1',
    slug: 'the-place',
    archivedAt: null,
  })
  membershipFindFirst.mockResolvedValue({ id: 'm-1', role })
  ownershipFindUnique.mockResolvedValue(null)
  userFindUnique.mockResolvedValue({ displayName: 'Max', avatarUrl: null })
}

/**
 * Mock del `$transaction` que invoca el callback con un `tx` que expone los
 * mismos mocks de alto nivel. Permite asserts simples sobre `flag.updateMany`,
 * `post.update`, `comment.update` sin simular Prisma al pie.
 */
function mockTransactionPassthrough(): void {
  transactionFn.mockImplementation(async (cb: TxArgs) => {
    const fn = cb as (tx: unknown) => Promise<unknown>
    return fn({
      flag: { updateMany: flagUpdateMany },
      post: { update: postUpdate, findUnique: postFindUnique },
      comment: { update: commentUpdate },
    })
  })
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('flagAction', () => {
  it('happy path: crea flag OPEN', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
    })
    flagCreate.mockResolvedValue({ id: 'f-1' })

    const result = await flagAction({
      targetType: 'POST',
      targetId: 'po-1',
      reason: 'SPAM',
    })
    expect(result).toEqual({ ok: true, flagId: 'f-1' })
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/settings/flags')
  })

  it('P2002 ⇒ FlagAlreadyExists', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
    })
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: '5',
    })
    flagCreate.mockRejectedValue(p2002)

    await expect(
      flagAction({ targetType: 'POST', targetId: 'po-1', reason: 'SPAM' }),
    ).rejects.toBeInstanceOf(FlagAlreadyExists)
  })

  it('NotFoundError si el post no existe', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue(null)
    await expect(
      flagAction({ targetType: 'POST', targetId: 'po-1', reason: 'SPAM' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('reviewFlagAction', () => {
  it('admin resuelve flag OPEN sin sideEffect', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    flagFindUnique.mockResolvedValue({
      id: 'f-1',
      placeId: 'place-1',
      status: 'OPEN',
      targetType: 'POST',
      targetId: 'po-1',
    })
    mockTransactionPassthrough()
    flagUpdateMany.mockResolvedValue({ count: 1 })

    const result = await reviewFlagAction({
      flagId: 'f-1',
      decision: 'REVIEWED_ACTIONED',
    })
    expect(result).toEqual({ ok: true })
    expect(flagUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'f-1', status: 'OPEN' },
        data: expect.objectContaining({ status: 'REVIEWED_ACTIONED' }),
      }),
    )
    expect(postUpdate).not.toHaveBeenCalled()
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/settings/flags')
    expect(revalidatePathFn).not.toHaveBeenCalledWith(expect.stringContaining('/conversations'))
  })

  it('member no puede revisar flags', async () => {
    mockActiveMember(MembershipRole.MEMBER)
    flagFindUnique.mockResolvedValue({
      id: 'f-1',
      placeId: 'place-1',
      status: 'OPEN',
      targetType: 'POST',
      targetId: 'po-1',
    })
    await expect(
      reviewFlagAction({ flagId: 'f-1', decision: 'REVIEWED_DISMISSED' }),
    ).rejects.toBeInstanceOf(AuthorizationError)
  })

  it('NotFoundError si otro admin ya resolvió', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    flagFindUnique.mockResolvedValue({
      id: 'f-1',
      placeId: 'place-1',
      status: 'OPEN',
      targetType: 'POST',
      targetId: 'po-1',
    })
    mockTransactionPassthrough()
    flagUpdateMany.mockResolvedValue({ count: 0 })

    await expect(
      reviewFlagAction({ flagId: 'f-1', decision: 'REVIEWED_DISMISSED' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('sideEffect=HIDE_TARGET sobre POST actualiza flag + post.hiddenAt + revalida conversation', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    flagFindUnique.mockResolvedValue({
      id: 'f-1',
      placeId: 'place-1',
      status: 'OPEN',
      targetType: 'POST',
      targetId: 'po-1',
    })
    mockTransactionPassthrough()
    flagUpdateMany.mockResolvedValue({ count: 1 })
    postUpdate.mockResolvedValue({ slug: 'post-slug' })

    const result = await reviewFlagAction({
      flagId: 'f-1',
      decision: 'REVIEWED_ACTIONED',
      sideEffect: 'HIDE_TARGET',
    })
    expect(result).toEqual({ ok: true })
    expect(postUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'po-1' },
        data: expect.objectContaining({ hiddenAt: expect.any(Date) }),
      }),
    )
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/settings/flags')
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/conversations')
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/conversations/post-slug')
  })

  it('sideEffect=DELETE_TARGET sobre POST hace hard delete + claim del flag + revalida', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    flagFindUnique.mockResolvedValue({
      id: 'f-1',
      placeId: 'place-1',
      status: 'OPEN',
      targetType: 'POST',
      targetId: 'po-1',
    })
    postFindUnique.mockResolvedValue({ slug: 'post-slug' })
    flagUpdateMany.mockResolvedValue({ count: 1 })
    hardDeletePostFn.mockResolvedValue(undefined)

    const result = await reviewFlagAction({
      flagId: 'f-1',
      decision: 'REVIEWED_ACTIONED',
      sideEffect: 'DELETE_TARGET',
    })
    expect(result).toEqual({ ok: true })
    expect(flagUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'f-1', status: 'OPEN' },
        data: expect.objectContaining({ status: 'REVIEWED_ACTIONED' }),
      }),
    )
    expect(hardDeletePostFn).toHaveBeenCalledWith('po-1')
    expect(postUpdate).not.toHaveBeenCalled()
    expect(transactionFn).not.toHaveBeenCalled()
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/settings/flags')
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/conversations')
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/conversations/post-slug')
  })

  it('sideEffect=DELETE_TARGET sobre POST: si claim del flag falla (race) ⇒ NotFoundError sin hard delete', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    flagFindUnique.mockResolvedValue({
      id: 'f-1',
      placeId: 'place-1',
      status: 'OPEN',
      targetType: 'POST',
      targetId: 'po-1',
    })
    postFindUnique.mockResolvedValue({ slug: 'post-slug' })
    flagUpdateMany.mockResolvedValue({ count: 0 })

    await expect(
      reviewFlagAction({
        flagId: 'f-1',
        decision: 'REVIEWED_ACTIONED',
        sideEffect: 'DELETE_TARGET',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(hardDeletePostFn).not.toHaveBeenCalled()
  })

  it('sideEffect=DELETE_TARGET sobre POST: post ya no existe ⇒ NotFoundError sin tocar flag ni hard delete', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    flagFindUnique.mockResolvedValue({
      id: 'f-1',
      placeId: 'place-1',
      status: 'OPEN',
      targetType: 'POST',
      targetId: 'po-1',
    })
    postFindUnique.mockResolvedValue(null)

    await expect(
      reviewFlagAction({
        flagId: 'f-1',
        decision: 'REVIEWED_ACTIONED',
        sideEffect: 'DELETE_TARGET',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(flagUpdateMany).not.toHaveBeenCalled()
    expect(hardDeletePostFn).not.toHaveBeenCalled()
  })

  it('sideEffect=DELETE_TARGET sobre COMMENT actualiza comment.deletedAt + revalida el thread', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    flagFindUnique.mockResolvedValue({
      id: 'f-1',
      placeId: 'place-1',
      status: 'OPEN',
      targetType: 'COMMENT',
      targetId: 'co-1',
    })
    mockTransactionPassthrough()
    flagUpdateMany.mockResolvedValue({ count: 1 })
    commentUpdate.mockResolvedValue({ postId: 'po-parent' })
    postFindUnique.mockResolvedValue({ slug: 'post-padre' })

    await reviewFlagAction({
      flagId: 'f-1',
      decision: 'REVIEWED_ACTIONED',
      sideEffect: 'DELETE_TARGET',
    })
    expect(commentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'co-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    )
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/conversations/post-padre')
    expect(revalidatePathFn).not.toHaveBeenCalledWith('/the-place/conversations')
  })

  it('sideEffect=HIDE_TARGET sobre COMMENT ⇒ ValidationError (comments no se ocultan)', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    flagFindUnique.mockResolvedValue({
      id: 'f-1',
      placeId: 'place-1',
      status: 'OPEN',
      targetType: 'COMMENT',
      targetId: 'co-1',
    })

    await expect(
      reviewFlagAction({
        flagId: 'f-1',
        decision: 'REVIEWED_ACTIONED',
        sideEffect: 'HIDE_TARGET',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(transactionFn).not.toHaveBeenCalled()
  })

  it('race con count=0 en HIDE_TARGET ⇒ tx rollback + NotFoundError, sin post.update', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    flagFindUnique.mockResolvedValue({
      id: 'f-1',
      placeId: 'place-1',
      status: 'OPEN',
      targetType: 'POST',
      targetId: 'po-1',
    })
    mockTransactionPassthrough()
    flagUpdateMany.mockResolvedValue({ count: 0 })

    await expect(
      reviewFlagAction({
        flagId: 'f-1',
        decision: 'REVIEWED_ACTIONED',
        sideEffect: 'HIDE_TARGET',
      }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(postUpdate).not.toHaveBeenCalled()
  })

  it('DISMISSED + sideEffect rechazado por schema antes de tocar DB', async () => {
    await expect(
      reviewFlagAction({
        flagId: 'f-1',
        decision: 'REVIEWED_DISMISSED',
        sideEffect: 'HIDE_TARGET',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(flagFindUnique).not.toHaveBeenCalled()
  })
})
