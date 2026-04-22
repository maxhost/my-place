import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MembershipRole } from '@prisma/client'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { EditWindowExpired, InvalidQuoteTarget } from '../domain/errors'

const placeFindUnique = vi.fn()
const membershipFindFirst = vi.fn()
const ownershipFindUnique = vi.fn()
const userFindUnique = vi.fn()
const postFindUnique = vi.fn()
const commentFindUnique = vi.fn()
const commentCreate = vi.fn()
const commentUpdateMany = vi.fn()
const postUpdateMany = vi.fn()
const transactionFn = vi.fn()
const getUserFn = vi.fn()
const assertPlaceOpenFn = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
    membership: { findFirst: (...a: unknown[]) => membershipFindFirst(...a) },
    placeOwnership: { findUnique: (...a: unknown[]) => ownershipFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    post: { findUnique: (...a: unknown[]) => postFindUnique(...a) },
    comment: {
      findUnique: (...a: unknown[]) => commentFindUnique(...a),
      create: (...a: unknown[]) => commentCreate(...a),
      updateMany: (...a: unknown[]) => commentUpdateMany(...a),
    },
    $transaction: (fn: (tx: unknown) => unknown) => transactionFn(fn),
  },
}))

vi.mock('@/shared/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: getUserFn } }),
}))

vi.mock('@/features/hours/public', () => ({
  assertPlaceOpenOrThrow: (...a: unknown[]) => assertPlaceOpenFn(...a),
}))

vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePathFn(...a) }))
vi.mock('server-only', () => ({}))

vi.mock('@/shared/config/env', () => ({
  serverEnv: {
    APP_EDIT_SESSION_SECRET: 'x'.repeat(48) + 'comments-actions-test-secret',
  },
}))

import {
  createCommentAction,
  deleteCommentAction,
  editCommentAction,
  openCommentEditSession,
} from '../server/actions/comments'
import { signEditSessionToken } from '@/shared/lib/edit-session-token'

const bodyDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'comentario' }] }],
}

function mockActiveMember(role: MembershipRole = MembershipRole.MEMBER): void {
  getUserFn.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  placeFindUnique.mockResolvedValue({ id: 'place-1', slug: 'the-place', archivedAt: null })
  membershipFindFirst.mockResolvedValue({ id: 'm-1', role })
  ownershipFindUnique.mockResolvedValue(null)
  userFindUnique.mockResolvedValue({ displayName: 'Max', avatarUrl: null })
  assertPlaceOpenFn.mockResolvedValue(undefined)
  transactionFn.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({
      comment: { create: commentCreate },
      post: { updateMany: postUpdateMany },
    }),
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('createCommentAction', () => {
  it('happy path sin cita: crea comment y actualiza lastActivityAt', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      slug: 'tema-1',
      hiddenAt: null,
    })
    commentCreate.mockResolvedValue({ id: 'c-1' })
    postUpdateMany.mockResolvedValue({ count: 1 })

    const result = await createCommentAction({
      postId: 'po-1',
      body: bodyDoc,
    })
    expect(result).toEqual({ ok: true, commentId: 'c-1' })
    expect(postUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'po-1' },
        data: expect.objectContaining({ lastActivityAt: expect.any(Date) }),
      }),
    )
  })

  it('con cita: congela snapshot y valida mismo post', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      slug: 'tema-1',
      hiddenAt: null,
    })
    commentFindUnique.mockResolvedValue({
      id: 'c-parent',
      postId: 'po-1',
      authorSnapshot: { displayName: 'Alguien', avatarUrl: null },
      body: bodyDoc,
      createdAt: new Date('2026-04-19'),
      deletedAt: null,
    })
    commentCreate.mockResolvedValue({ id: 'c-new' })
    postUpdateMany.mockResolvedValue({ count: 1 })

    const result = await createCommentAction({
      postId: 'po-1',
      body: bodyDoc,
      quotedCommentId: 'c-parent',
    })
    expect(result.ok).toBe(true)
    expect(commentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quotedCommentId: 'c-parent',
          quotedSnapshot: expect.objectContaining({
            commentId: 'c-parent',
            authorLabel: 'Alguien',
          }),
        }),
      }),
    )
  })

  it('cita cross-post => InvalidQuoteTarget', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      slug: 'tema-1',
      hiddenAt: null,
    })
    commentFindUnique.mockResolvedValue({
      id: 'c-other',
      postId: 'po-OTRO',
      authorSnapshot: { displayName: 'X', avatarUrl: null },
      body: bodyDoc,
      createdAt: new Date(),
      deletedAt: null,
    })
    await expect(
      createCommentAction({
        postId: 'po-1',
        body: bodyDoc,
        quotedCommentId: 'c-other',
      }),
    ).rejects.toBeInstanceOf(InvalidQuoteTarget)
  })

  it('ValidationError si body falta', async () => {
    await expect(createCommentAction({ postId: 'po-1' })).rejects.toBeInstanceOf(ValidationError)
  })

  it('NotFoundError si post no existe', async () => {
    postFindUnique.mockResolvedValue(null)
    await expect(createCommentAction({ postId: 'po-x', body: bodyDoc })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

describe('editCommentAction', () => {
  it('autor dentro de 60s: updatea body + bumpea version y revalida detail por slug', async () => {
    mockActiveMember()
    commentFindUnique.mockResolvedValue({
      id: 'c-1',
      placeId: 'place-1',
      postId: 'po-1',
      authorUserId: 'user-1',
      createdAt: new Date(),
      deletedAt: null,
      post: { slug: 'tema-1' },
    })
    commentUpdateMany.mockResolvedValue({ count: 1 })

    const result = await editCommentAction({
      commentId: 'c-1',
      body: bodyDoc,
      expectedVersion: 0,
    })
    expect(result).toEqual({ ok: true, version: 1 })
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/conversations/tema-1')
  })

  it('no-autor rechaza con AuthorizationError', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    commentFindUnique.mockResolvedValue({
      id: 'c-1',
      placeId: 'place-1',
      postId: 'po-1',
      authorUserId: 'other',
      createdAt: new Date(),
      deletedAt: null,
      post: { slug: 'tema-1' },
    })
    await expect(
      editCommentAction({ commentId: 'c-1', body: bodyDoc, expectedVersion: 0 }),
    ).rejects.toBeInstanceOf(AuthorizationError)
  })

  it('con session token válido: autor guarda aunque pasaron los 60s', async () => {
    mockActiveMember()
    const createdAt = new Date(Date.now() - 120_000)
    const openedAt = new Date(Date.now() - 90_000)
    commentFindUnique.mockResolvedValue({
      id: 'c-1',
      placeId: 'place-1',
      postId: 'po-1',
      authorUserId: 'user-1',
      createdAt,
      deletedAt: null,
      post: { slug: 'tema-1' },
    })
    commentUpdateMany.mockResolvedValue({ count: 1 })
    const token = signEditSessionToken({
      subjectType: 'COMMENT',
      subjectId: 'c-1',
      userId: 'user-1',
      openedAt: openedAt.toISOString(),
    })
    const result = await editCommentAction({
      commentId: 'c-1',
      body: bodyDoc,
      expectedVersion: 0,
      session: { token, openedAt: openedAt.toISOString() },
    })
    expect(result).toEqual({ ok: true, version: 1 })
  })

  it('token firmado para otro commentId → EditSessionInvalid', async () => {
    mockActiveMember()
    const createdAt = new Date(Date.now() - 30_000)
    const openedAt = new Date(Date.now() - 20_000)
    commentFindUnique.mockResolvedValue({
      id: 'c-1',
      placeId: 'place-1',
      postId: 'po-1',
      authorUserId: 'user-1',
      createdAt,
      deletedAt: null,
      post: { slug: 'tema-1' },
    })
    const token = signEditSessionToken({
      subjectType: 'COMMENT',
      subjectId: 'c-OTRO',
      userId: 'user-1',
      openedAt: openedAt.toISOString(),
    })
    await expect(
      editCommentAction({
        commentId: 'c-1',
        body: bodyDoc,
        expectedVersion: 0,
        session: { token, openedAt: openedAt.toISOString() },
      }),
    ).rejects.toMatchObject({ context: { reason: 'bad_signature' } })
  })

  it('token válido pero grace window expiró → EditSessionInvalid expired', async () => {
    mockActiveMember()
    const createdAt = new Date(Date.now() - 30_000)
    const openedAt = new Date(Date.now() - 10 * 60 * 1000)
    commentFindUnique.mockResolvedValue({
      id: 'c-1',
      placeId: 'place-1',
      postId: 'po-1',
      authorUserId: 'user-1',
      createdAt,
      deletedAt: null,
      post: { slug: 'tema-1' },
    })
    const token = signEditSessionToken({
      subjectType: 'COMMENT',
      subjectId: 'c-1',
      userId: 'user-1',
      openedAt: openedAt.toISOString(),
    })
    await expect(
      editCommentAction({
        commentId: 'c-1',
        body: bodyDoc,
        expectedVersion: 0,
        session: { token, openedAt: openedAt.toISOString() },
      }),
    ).rejects.toMatchObject({ context: { reason: 'expired' } })
  })

  it('token con openedAt fuera de los 60s → EditWindowExpired', async () => {
    mockActiveMember()
    const createdAt = new Date(Date.now() - 10 * 60 * 1000)
    const openedAt = new Date(Date.now() - 60_000)
    commentFindUnique.mockResolvedValue({
      id: 'c-1',
      placeId: 'place-1',
      postId: 'po-1',
      authorUserId: 'user-1',
      createdAt,
      deletedAt: null,
      post: { slug: 'tema-1' },
    })
    const token = signEditSessionToken({
      subjectType: 'COMMENT',
      subjectId: 'c-1',
      userId: 'user-1',
      openedAt: openedAt.toISOString(),
    })
    await expect(
      editCommentAction({
        commentId: 'c-1',
        body: bodyDoc,
        expectedVersion: 0,
        session: { token, openedAt: openedAt.toISOString() },
      }),
    ).rejects.toBeInstanceOf(EditWindowExpired)
  })
})

describe('openCommentEditSession', () => {
  it('autor dentro de 60s: devuelve token firmado', async () => {
    mockActiveMember()
    commentFindUnique.mockResolvedValue({
      id: 'c-1',
      placeId: 'place-1',
      authorUserId: 'user-1',
      createdAt: new Date(Date.now() - 10_000),
      deletedAt: null,
    })
    const result = await openCommentEditSession({ commentId: 'c-1' })
    expect(result).toMatchObject({
      ok: true,
      session: {
        token: expect.any(String),
        openedAt: expect.any(String),
        graceMs: 5 * 60 * 1000,
      },
    })
  })

  it('autor fuera de 60s: EditWindowExpired', async () => {
    mockActiveMember()
    commentFindUnique.mockResolvedValue({
      id: 'c-1',
      placeId: 'place-1',
      authorUserId: 'user-1',
      createdAt: new Date(Date.now() - 120_000),
      deletedAt: null,
    })
    await expect(openCommentEditSession({ commentId: 'c-1' })).rejects.toBeInstanceOf(
      EditWindowExpired,
    )
  })

  it('no-autor: AuthorizationError (comments no tienen admin-edit)', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    commentFindUnique.mockResolvedValue({
      id: 'c-1',
      placeId: 'place-1',
      authorUserId: 'other',
      createdAt: new Date(),
      deletedAt: null,
    })
    await expect(openCommentEditSession({ commentId: 'c-1' })).rejects.toBeInstanceOf(
      AuthorizationError,
    )
  })

  it('NotFoundError si el comment no existe', async () => {
    mockActiveMember()
    commentFindUnique.mockResolvedValue(null)
    await expect(openCommentEditSession({ commentId: 'c-x' })).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('deleteCommentAction', () => {
  it('admin borra comentario ajeno', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    commentFindUnique.mockResolvedValue({
      id: 'c-1',
      placeId: 'place-1',
      postId: 'po-1',
      authorUserId: 'other',
      createdAt: new Date(Date.now() - 3600_000),
      deletedAt: null,
      post: { slug: 'tema-1' },
    })
    commentUpdateMany.mockResolvedValue({ count: 1 })
    const result = await deleteCommentAction({ commentId: 'c-1', expectedVersion: 0 })
    expect(result).toEqual({ ok: true, version: 1 })
  })
})
