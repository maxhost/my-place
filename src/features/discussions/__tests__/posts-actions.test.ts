import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MembershipRole, Prisma } from '@prisma/client'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  OutOfHoursError,
  ValidationError,
} from '@/shared/errors/domain-error'
import { EditWindowExpired } from '../domain/errors'
const placeFindUnique = vi.fn()
const membershipFindFirst = vi.fn()
const ownershipFindUnique = vi.fn()
const userFindUnique = vi.fn()
const postCreate = vi.fn()
const postFindUnique = vi.fn()
const postFindMany = vi.fn()
const postUpdateMany = vi.fn()
const getUserFn = vi.fn()
const assertPlaceOpenFn = vi.fn()
const revalidatePathFn = vi.fn()
const hardDeletePostFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
    membership: { findFirst: (...a: unknown[]) => membershipFindFirst(...a) },
    placeOwnership: { findUnique: (...a: unknown[]) => ownershipFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    post: {
      create: (...a: unknown[]) => postCreate(...a),
      findUnique: (...a: unknown[]) => postFindUnique(...a),
      findMany: (...a: unknown[]) => postFindMany(...a),
      updateMany: (...a: unknown[]) => postUpdateMany(...a),
    },
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
    APP_EDIT_SESSION_SECRET: 'x'.repeat(48) + 'posts-actions-test-secret',
  },
}))

vi.mock('../server/hard-delete', () => ({
  hardDeletePost: (...a: unknown[]) => hardDeletePostFn(...a),
}))

import {
  createPostAction,
  deletePostAction,
  editPostAction,
  hidePostAction,
  openPostEditSession,
} from '../server/actions/posts'
import { signEditSessionToken } from '@/shared/lib/edit-session-token'

const bodyDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hola' }] }],
}

function mockActiveMember(role: MembershipRole = MembershipRole.MEMBER): void {
  getUserFn.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  placeFindUnique.mockResolvedValue({ id: 'place-1', slug: 'the-place', archivedAt: null })
  membershipFindFirst.mockResolvedValue({ id: 'm-1', role })
  ownershipFindUnique.mockResolvedValue(null)
  userFindUnique.mockResolvedValue({ displayName: 'Max', avatarUrl: null })
  assertPlaceOpenFn.mockResolvedValue(undefined)
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('createPostAction', () => {
  it('happy path: crea post con slug y revalida las 3 rutas relevantes', async () => {
    mockActiveMember()
    postFindMany.mockResolvedValue([])
    postCreate.mockResolvedValue({ id: 'po-1', slug: 'tema-nuevo' })
    const result = await createPostAction({
      placeId: 'place-1',
      title: 'Tema nuevo',
      body: bodyDoc,
    })
    expect(result).toEqual({ ok: true, postId: 'po-1', slug: 'tema-nuevo' })
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place')
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/conversations')
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/conversations/tema-nuevo')
    expect(postCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          placeId: 'place-1',
          authorUserId: 'user-1',
          title: 'Tema nuevo',
          slug: 'tema-nuevo',
        }),
      }),
    )
  })

  it('título colisiona con slug existente → sufijo -2', async () => {
    mockActiveMember()
    postFindMany.mockResolvedValue([{ slug: 'tema-nuevo' }])
    postCreate.mockImplementation((args: { data: { slug: string } }) => ({
      id: 'po-2',
      slug: args.data.slug,
    }))
    const result = await createPostAction({
      placeId: 'place-1',
      title: 'Tema nuevo',
    })
    expect(result.slug).toBe('tema-nuevo-2')
  })

  it('título cae en RESERVED ("Settings") → sufijo -2 incluso sin filas previas', async () => {
    mockActiveMember()
    postFindMany.mockResolvedValue([])
    postCreate.mockImplementation((args: { data: { slug: string } }) => ({
      id: 'po-3',
      slug: args.data.slug,
    }))
    const result = await createPostAction({
      placeId: 'place-1',
      title: 'Settings',
    })
    expect(result.slug).toBe('settings-2')
  })

  it('P2002 en primer intento → reintenta con colisiones actualizadas', async () => {
    mockActiveMember()
    postFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ slug: 'tema-nuevo' }])
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: '5',
    })
    postCreate
      .mockRejectedValueOnce(p2002)
      .mockResolvedValueOnce({ id: 'po-4', slug: 'tema-nuevo-2' })
    const result = await createPostAction({
      placeId: 'place-1',
      title: 'Tema nuevo',
    })
    expect(result).toEqual({
      ok: true,
      postId: 'po-4',
      slug: 'tema-nuevo-2',
    })
  })

  it('P2002 dos veces seguidas → ConflictError', async () => {
    mockActiveMember()
    postFindMany.mockResolvedValue([])
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: '5',
    })
    postCreate.mockRejectedValue(p2002)
    await expect(
      createPostAction({ placeId: 'place-1', title: 'Tema nuevo' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('ValidationError si título es sólo whitespace', async () => {
    await expect(
      createPostAction({ placeId: 'place-1', title: '   ', body: null }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('AuthorizationError si no es miembro activo', async () => {
    getUserFn.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    placeFindUnique.mockResolvedValue({ id: 'place-1', slug: 's', archivedAt: null })
    membershipFindFirst.mockResolvedValue(null)
    ownershipFindUnique.mockResolvedValue(null)
    userFindUnique.mockResolvedValue({ displayName: 'Max', avatarUrl: null })
    await expect(createPostAction({ placeId: 'place-1', title: 'Tema' })).rejects.toBeInstanceOf(
      AuthorizationError,
    )
  })

  it('OutOfHoursError si place cerrado', async () => {
    mockActiveMember()
    assertPlaceOpenFn.mockRejectedValue(new OutOfHoursError('cerrado', 'place-1', null))
    await expect(createPostAction({ placeId: 'place-1', title: 'Tema' })).rejects.toBeInstanceOf(
      OutOfHoursError,
    )
    expect(postCreate).not.toHaveBeenCalled()
  })
})

describe('editPostAction', () => {
  it('happy path dentro de 60s => updatea y bumpea version', async () => {
    mockActiveMember()
    const now = new Date()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'user-1',
      slug: 'slug-estable',
      createdAt: new Date(now.getTime() - 10_000),
      hiddenAt: null,
    })
    postUpdateMany.mockResolvedValue({ count: 1 })

    const result = await editPostAction({
      postId: 'po-1',
      title: 'Nuevo título',
      body: bodyDoc,
      expectedVersion: 0,
    })
    expect(result).toEqual({ ok: true, version: 1 })
    expect(postUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'po-1', version: 0 },
      }),
    )
  })

  it('slug estable: editPost NO actualiza el slug aunque el título cambie', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'user-1',
      slug: 'slug-original',
      createdAt: new Date(Date.now() - 5_000),
      hiddenAt: null,
    })
    postUpdateMany.mockResolvedValue({ count: 1 })

    await editPostAction({
      postId: 'po-1',
      title: 'Título totalmente diferente',
      expectedVersion: 0,
    })
    const updateCall = postUpdateMany.mock.calls[0]?.[0]
    expect(updateCall?.data).not.toHaveProperty('slug')
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/conversations/slug-original')
  })

  it('EditWindowExpired tras los 60s si el autor (no admin) intenta editar', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'user-1',
      slug: 's',
      createdAt: new Date(Date.now() - 120_000),
      hiddenAt: null,
    })
    await expect(
      editPostAction({
        postId: 'po-1',
        title: 'Tarde',
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(EditWindowExpired)
  })

  it('AuthorizationError si no es el autor ni admin', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'other-user',
      slug: 's',
      createdAt: new Date(),
      hiddenAt: null,
    })
    await expect(
      editPostAction({ postId: 'po-1', title: 'Ajeno', expectedVersion: 0 }),
    ).rejects.toBeInstanceOf(AuthorizationError)
  })

  it('admin puede editar un post ajeno fuera de la ventana de 60s', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'other-user',
      slug: 'slug-original',
      createdAt: new Date(Date.now() - 3_600_000),
      hiddenAt: null,
    })
    postUpdateMany.mockResolvedValue({ count: 1 })
    const result = await editPostAction({
      postId: 'po-1',
      title: 'Fix admin',
      expectedVersion: 0,
    })
    expect(result).toEqual({ ok: true, version: 1 })
  })

  it('ConflictError si el expectedVersion no matchea', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'user-1',
      slug: 's',
      createdAt: new Date(),
      hiddenAt: null,
    })
    postUpdateMany.mockResolvedValue({ count: 0 })
    await expect(
      editPostAction({ postId: 'po-1', title: 'Ok', expectedVersion: 5 }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('con session token válido: autor guarda aunque pasaron los 60s', async () => {
    mockActiveMember()
    const createdAt = new Date(Date.now() - 120_000) // 2 min atrás
    const openedAt = new Date(Date.now() - 90_000) // abrió a los 30s de creado
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'user-1',
      slug: 's',
      createdAt,
      hiddenAt: null,
    })
    postUpdateMany.mockResolvedValue({ count: 1 })
    const token = signEditSessionToken({
      subjectType: 'POST',
      subjectId: 'po-1',
      userId: 'user-1',
      openedAt: openedAt.toISOString(),
    })
    const result = await editPostAction({
      postId: 'po-1',
      title: 'Fix tipo',
      expectedVersion: 0,
      session: { token, openedAt: openedAt.toISOString() },
    })
    expect(result).toEqual({ ok: true, version: 1 })
  })

  it('token firmado para otro postId → EditSessionInvalid', async () => {
    mockActiveMember()
    const createdAt = new Date(Date.now() - 30_000)
    const openedAt = new Date(Date.now() - 20_000)
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'user-1',
      slug: 's',
      createdAt,
      hiddenAt: null,
    })
    const token = signEditSessionToken({
      subjectType: 'POST',
      subjectId: 'po-OTRO',
      userId: 'user-1',
      openedAt: openedAt.toISOString(),
    })
    await expect(
      editPostAction({
        postId: 'po-1',
        title: 'Fraude',
        expectedVersion: 0,
        session: { token, openedAt: openedAt.toISOString() },
      }),
    ).rejects.toMatchObject({ context: { reason: 'bad_signature' } })
  })

  it('token válido pero grace window expiró → EditSessionInvalid expired', async () => {
    mockActiveMember()
    const createdAt = new Date(Date.now() - 30_000)
    const openedAt = new Date(Date.now() - 10 * 60 * 1000) // 10 min atrás
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'user-1',
      slug: 's',
      createdAt,
      hiddenAt: null,
    })
    const token = signEditSessionToken({
      subjectType: 'POST',
      subjectId: 'po-1',
      userId: 'user-1',
      openedAt: openedAt.toISOString(),
    })
    await expect(
      editPostAction({
        postId: 'po-1',
        title: 'Tarde',
        expectedVersion: 0,
        session: { token, openedAt: openedAt.toISOString() },
      }),
    ).rejects.toMatchObject({ context: { reason: 'expired' } })
  })

  it('token con openedAt fuera de los 60s → EditWindowExpired', async () => {
    mockActiveMember()
    const createdAt = new Date(Date.now() - 10 * 60 * 1000)
    const openedAt = new Date(Date.now() - 60_000) // abrió a los 9min de creado
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'user-1',
      slug: 's',
      createdAt,
      hiddenAt: null,
    })
    const token = signEditSessionToken({
      subjectType: 'POST',
      subjectId: 'po-1',
      userId: 'user-1',
      openedAt: openedAt.toISOString(),
    })
    await expect(
      editPostAction({
        postId: 'po-1',
        title: 'Demasiado tarde',
        expectedVersion: 0,
        session: { token, openedAt: openedAt.toISOString() },
      }),
    ).rejects.toBeInstanceOf(EditWindowExpired)
  })

  it('admin no necesita token (aunque lo mande, se ignora)', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'other',
      slug: 'slug-original',
      createdAt: new Date(Date.now() - 3_600_000),
      hiddenAt: null,
    })
    postUpdateMany.mockResolvedValue({ count: 1 })
    const result = await editPostAction({
      postId: 'po-1',
      title: 'Admin fix',
      expectedVersion: 0,
    })
    expect(result).toEqual({ ok: true, version: 1 })
  })
})

describe('openPostEditSession', () => {
  it('autor dentro de 60s: devuelve token firmado', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'user-1',
      createdAt: new Date(Date.now() - 10_000),
    })
    const result = await openPostEditSession({ postId: 'po-1' })
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
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'user-1',
      createdAt: new Date(Date.now() - 120_000),
    })
    await expect(openPostEditSession({ postId: 'po-1' })).rejects.toBeInstanceOf(EditWindowExpired)
  })

  it('admin: adminBypass sin token', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'other',
      createdAt: new Date(Date.now() - 3600_000),
    })
    const result = await openPostEditSession({ postId: 'po-1' })
    expect(result).toEqual({ ok: true, adminBypass: true })
  })

  it('no-autor ni admin: AuthorizationError', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'other',
      createdAt: new Date(),
    })
    await expect(openPostEditSession({ postId: 'po-1' })).rejects.toBeInstanceOf(AuthorizationError)
  })

  it('NotFoundError si el post no existe', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue(null)
    await expect(openPostEditSession({ postId: 'po-x' })).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('hidePostAction', () => {
  it('AuthorizationError si no es admin', async () => {
    mockActiveMember(MembershipRole.MEMBER)
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      slug: 's',
    })
    await expect(hidePostAction({ postId: 'po-1', expectedVersion: 0 })).rejects.toBeInstanceOf(
      AuthorizationError,
    )
  })

  it('ADMIN hide happy path', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      slug: 's',
    })
    postUpdateMany.mockResolvedValue({ count: 1 })
    const result = await hidePostAction({ postId: 'po-1', expectedVersion: 0 })
    expect(result).toEqual({ ok: true, version: 1 })
  })
})

describe('deletePostAction', () => {
  it('admin borra post ajeno via hard delete', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'other',
      slug: 's',
      createdAt: new Date(Date.now() - 3600_000),
      version: 0,
    })
    hardDeletePostFn.mockResolvedValue(undefined)
    const result = await deletePostAction({ postId: 'po-1', expectedVersion: 0 })
    expect(result).toEqual({ ok: true })
    expect(hardDeletePostFn).toHaveBeenCalledWith('po-1')
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/conversations/s')
  })

  it('autor borra propio post dentro de 60s', async () => {
    mockActiveMember()
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'user-1',
      slug: 's',
      createdAt: new Date(Date.now() - 10_000),
      version: 0,
    })
    hardDeletePostFn.mockResolvedValue(undefined)
    const result = await deletePostAction({ postId: 'po-1', expectedVersion: 0 })
    expect(result).toEqual({ ok: true })
    expect(hardDeletePostFn).toHaveBeenCalledWith('po-1')
  })

  it('NotFoundError si el post no existe', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    postFindUnique.mockResolvedValue(null)
    await expect(deletePostAction({ postId: 'po-1', expectedVersion: 0 })).rejects.toBeInstanceOf(
      NotFoundError,
    )
    expect(hardDeletePostFn).not.toHaveBeenCalled()
  })

  it('ConflictError si expectedVersion no matchea', async () => {
    mockActiveMember(MembershipRole.ADMIN)
    postFindUnique.mockResolvedValue({
      id: 'po-1',
      placeId: 'place-1',
      authorUserId: 'other',
      slug: 's',
      createdAt: new Date(Date.now() - 60_000),
      version: 3,
    })
    await expect(deletePostAction({ postId: 'po-1', expectedVersion: 0 })).rejects.toBeInstanceOf(
      ConflictError,
    )
    expect(hardDeletePostFn).not.toHaveBeenCalled()
  })
})
