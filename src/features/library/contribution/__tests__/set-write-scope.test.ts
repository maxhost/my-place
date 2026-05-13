import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Tests para `setLibraryCategoryWriteScopeAction` (S1a — write access scopes).
 *
 * Action category-centric. Owner-only. Override completo: borra todas
 * las rows de las 3 tablas + recrea sólo la del kind elegido + setea
 * `LibraryCategory.writeAccessKind`.
 *
 * Discriminated union return:
 *  - { ok: true }
 *  - { ok: false, error: 'group_not_in_place' | 'tier_not_in_place' | 'member_not_in_place' }
 *
 * Simétrico al set-read-scope del sub-slice `library/access`.
 */

const libraryCategoryFindUnique = vi.fn()
const libraryCategoryUpdate = vi.fn()
const placeFindUnique = vi.fn()
const ownershipFindUnique = vi.fn()
const permissionGroupFindMany = vi.fn()
const tierFindMany = vi.fn()
const membershipFindMany = vi.fn()
const groupWriteDeleteMany = vi.fn()
const groupWriteCreateMany = vi.fn()
const tierWriteDeleteMany = vi.fn()
const tierWriteCreateMany = vi.fn()
const userWriteDeleteMany = vi.fn()
const userWriteCreateMany = vi.fn()
const transactionFn = vi.fn()
const getUserFn = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    libraryCategory: {
      findUnique: (...a: unknown[]) => libraryCategoryFindUnique(...a),
      update: (...a: unknown[]) => libraryCategoryUpdate(...a),
    },
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
    placeOwnership: { findUnique: (...a: unknown[]) => ownershipFindUnique(...a) },
    permissionGroup: { findMany: (...a: unknown[]) => permissionGroupFindMany(...a) },
    tier: { findMany: (...a: unknown[]) => tierFindMany(...a) },
    membership: { findMany: (...a: unknown[]) => membershipFindMany(...a) },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => transactionFn(fn),
  },
}))

vi.mock('@/shared/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: getUserFn } }),
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
}))
vi.mock('server-only', () => ({}))

vi.mock('@/shared/config/env', () => ({
  serverEnv: { NODE_ENV: 'test' },
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    NEXT_PUBLIC_APP_URL: 'http://lvh.me:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000',
  },
}))

import { setLibraryCategoryWriteScopeAction } from '../server/actions/set-write-scope'

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'the-place'
const CATEGORY_ID = 'cat-1'
const CATEGORY_SLUG = 'recetas'
const ACTOR_ID = 'user-1'
const GROUP_ID = 'grp-mods'
const TIER_ID = 'tier-pro'
const MEMBER_ID = 'member-99'

function mockOwnerHappy(): void {
  getUserFn.mockResolvedValue({ data: { user: { id: ACTOR_ID } } })
  libraryCategoryFindUnique.mockResolvedValue({
    id: CATEGORY_ID,
    placeId: PLACE_ID,
    slug: CATEGORY_SLUG,
    archivedAt: null,
  })
  placeFindUnique.mockResolvedValue({ id: PLACE_ID, slug: PLACE_SLUG, archivedAt: null })
  ownershipFindUnique.mockResolvedValue({ userId: ACTOR_ID })
  transactionFn.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      libraryCategory: {
        update: libraryCategoryUpdate,
      },
      libraryCategoryGroupWriteScope: {
        deleteMany: groupWriteDeleteMany,
        createMany: groupWriteCreateMany,
      },
      libraryCategoryTierWriteScope: {
        deleteMany: tierWriteDeleteMany,
        createMany: tierWriteCreateMany,
      },
      libraryCategoryUserWriteScope: {
        deleteMany: userWriteDeleteMany,
        createMany: userWriteCreateMany,
      },
    }),
  )
  groupWriteDeleteMany.mockResolvedValue({ count: 0 })
  groupWriteCreateMany.mockResolvedValue({ count: 0 })
  tierWriteDeleteMany.mockResolvedValue({ count: 0 })
  tierWriteCreateMany.mockResolvedValue({ count: 0 })
  userWriteDeleteMany.mockResolvedValue({ count: 0 })
  userWriteCreateMany.mockResolvedValue({ count: 0 })
  libraryCategoryUpdate.mockResolvedValue({})
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('setLibraryCategoryWriteScopeAction — validación + auth', () => {
  it('rechaza input inválido (sin kind) con ValidationError', async () => {
    await expect(
      setLibraryCategoryWriteScopeAction({ categoryId: CATEGORY_ID }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(getUserFn).not.toHaveBeenCalled()
  })

  it('rechaza payload mismatch (kind=GROUPS sin groupIds) con ValidationError', async () => {
    await expect(
      setLibraryCategoryWriteScopeAction({ categoryId: CATEGORY_ID, kind: 'GROUPS' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('rechaza payload mismatch (kind=GROUPS con userIds) con ValidationError', async () => {
    await expect(
      setLibraryCategoryWriteScopeAction({
        categoryId: CATEGORY_ID,
        kind: 'GROUPS',
        userIds: [MEMBER_ID],
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('rechaza array > 50 entries con ValidationError', async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `grp-${i}`)
    await expect(
      setLibraryCategoryWriteScopeAction({
        categoryId: CATEGORY_ID,
        kind: 'GROUPS',
        groupIds: tooMany,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('rechaza sin sesión con AuthorizationError', async () => {
    getUserFn.mockResolvedValue({ data: { user: null } })
    await expect(
      setLibraryCategoryWriteScopeAction({ categoryId: CATEGORY_ID, kind: 'OWNER_ONLY' }),
    ).rejects.toBeInstanceOf(AuthorizationError)
  })

  it('rechaza categoría inexistente con NotFoundError', async () => {
    getUserFn.mockResolvedValue({ data: { user: { id: ACTOR_ID } } })
    libraryCategoryFindUnique.mockResolvedValue(null)
    await expect(
      setLibraryCategoryWriteScopeAction({ categoryId: 'cat-x', kind: 'OWNER_ONLY' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rechaza categoría archivada con NotFoundError', async () => {
    getUserFn.mockResolvedValue({ data: { user: { id: ACTOR_ID } } })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
      archivedAt: new Date(),
    })
    await expect(
      setLibraryCategoryWriteScopeAction({ categoryId: CATEGORY_ID, kind: 'OWNER_ONLY' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rechaza place archivado con NotFoundError', async () => {
    getUserFn.mockResolvedValue({ data: { user: { id: ACTOR_ID } } })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
      archivedAt: null,
    })
    placeFindUnique.mockResolvedValue({ id: PLACE_ID, slug: PLACE_SLUG, archivedAt: new Date() })
    await expect(
      setLibraryCategoryWriteScopeAction({ categoryId: CATEGORY_ID, kind: 'OWNER_ONLY' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rechaza no-owner con AuthorizationError (admin no basta)', async () => {
    getUserFn.mockResolvedValue({ data: { user: { id: ACTOR_ID } } })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
      archivedAt: null,
    })
    placeFindUnique.mockResolvedValue({ id: PLACE_ID, slug: PLACE_SLUG, archivedAt: null })
    ownershipFindUnique.mockResolvedValue(null)
    await expect(
      setLibraryCategoryWriteScopeAction({ categoryId: CATEGORY_ID, kind: 'OWNER_ONLY' }),
    ).rejects.toBeInstanceOf(AuthorizationError)
    expect(transactionFn).not.toHaveBeenCalled()
  })
})

describe('setLibraryCategoryWriteScopeAction — kind=OWNER_ONLY', () => {
  it('borra los 3 sets + setea kind=OWNER_ONLY, sin createMany', async () => {
    mockOwnerHappy()

    const result = await setLibraryCategoryWriteScopeAction({
      categoryId: CATEGORY_ID,
      kind: 'OWNER_ONLY',
    })

    expect(result).toEqual({ ok: true })
    expect(transactionFn).toHaveBeenCalledTimes(1)
    expect(libraryCategoryUpdate).toHaveBeenCalledWith({
      where: { id: CATEGORY_ID },
      data: { writeAccessKind: 'OWNER_ONLY' },
    })
    expect(groupWriteDeleteMany).toHaveBeenCalledWith({ where: { categoryId: CATEGORY_ID } })
    expect(tierWriteDeleteMany).toHaveBeenCalledWith({ where: { categoryId: CATEGORY_ID } })
    expect(userWriteDeleteMany).toHaveBeenCalledWith({ where: { categoryId: CATEGORY_ID } })
    expect(groupWriteCreateMany).not.toHaveBeenCalled()
    expect(tierWriteCreateMany).not.toHaveBeenCalled()
    expect(userWriteCreateMany).not.toHaveBeenCalled()
    expect(permissionGroupFindMany).not.toHaveBeenCalled()
    expect(tierFindMany).not.toHaveBeenCalled()
    expect(membershipFindMany).not.toHaveBeenCalled()
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library/${CATEGORY_SLUG}`)
  })
})

describe('setLibraryCategoryWriteScopeAction — kind=GROUPS', () => {
  it('valida pertenencia, borra los 3 + crea group rows + setea kind', async () => {
    mockOwnerHappy()
    permissionGroupFindMany.mockResolvedValue([{ id: GROUP_ID }])

    const result = await setLibraryCategoryWriteScopeAction({
      categoryId: CATEGORY_ID,
      kind: 'GROUPS',
      groupIds: [GROUP_ID],
    })

    expect(result).toEqual({ ok: true })
    expect(permissionGroupFindMany).toHaveBeenCalledWith({
      where: { id: { in: [GROUP_ID] }, placeId: PLACE_ID },
      select: { id: true },
    })
    expect(libraryCategoryUpdate).toHaveBeenCalledWith({
      where: { id: CATEGORY_ID },
      data: { writeAccessKind: 'GROUPS' },
    })
    expect(groupWriteDeleteMany).toHaveBeenCalled()
    expect(tierWriteDeleteMany).toHaveBeenCalled()
    expect(userWriteDeleteMany).toHaveBeenCalled()
    expect(groupWriteCreateMany).toHaveBeenCalledWith({
      data: [{ categoryId: CATEGORY_ID, groupId: GROUP_ID }],
      skipDuplicates: true,
    })
    expect(tierWriteCreateMany).not.toHaveBeenCalled()
    expect(userWriteCreateMany).not.toHaveBeenCalled()
  })

  it('groupIds=[] con kind=GROUPS: setea kind, borra todo, no crea', async () => {
    mockOwnerHappy()
    const result = await setLibraryCategoryWriteScopeAction({
      categoryId: CATEGORY_ID,
      kind: 'GROUPS',
      groupIds: [],
    })
    expect(result).toEqual({ ok: true })
    expect(permissionGroupFindMany).not.toHaveBeenCalled()
    expect(groupWriteCreateMany).not.toHaveBeenCalled()
  })

  it('dedupe groupIds duplicados', async () => {
    mockOwnerHappy()
    permissionGroupFindMany.mockResolvedValue([{ id: GROUP_ID }])
    await setLibraryCategoryWriteScopeAction({
      categoryId: CATEGORY_ID,
      kind: 'GROUPS',
      groupIds: [GROUP_ID, GROUP_ID, GROUP_ID],
    })
    expect(permissionGroupFindMany).toHaveBeenCalledWith({
      where: { id: { in: [GROUP_ID] }, placeId: PLACE_ID },
      select: { id: true },
    })
    expect(groupWriteCreateMany).toHaveBeenCalledWith({
      data: [{ categoryId: CATEGORY_ID, groupId: GROUP_ID }],
      skipDuplicates: true,
    })
  })

  it('algún groupId no pertenece al place: { ok:false, error:group_not_in_place }', async () => {
    mockOwnerHappy()
    permissionGroupFindMany.mockResolvedValue([{ id: GROUP_ID }])
    const result = await setLibraryCategoryWriteScopeAction({
      categoryId: CATEGORY_ID,
      kind: 'GROUPS',
      groupIds: [GROUP_ID, 'grp-otro-place'],
    })
    expect(result).toEqual({ ok: false, error: 'group_not_in_place' })
    expect(transactionFn).not.toHaveBeenCalled()
  })
})

describe('setLibraryCategoryWriteScopeAction — kind=TIERS', () => {
  it('valida pertenencia + crea tier rows + setea kind', async () => {
    mockOwnerHappy()
    tierFindMany.mockResolvedValue([{ id: TIER_ID }])

    const result = await setLibraryCategoryWriteScopeAction({
      categoryId: CATEGORY_ID,
      kind: 'TIERS',
      tierIds: [TIER_ID],
    })

    expect(result).toEqual({ ok: true })
    expect(tierFindMany).toHaveBeenCalledWith({
      where: { id: { in: [TIER_ID] }, placeId: PLACE_ID },
      select: { id: true },
    })
    expect(libraryCategoryUpdate).toHaveBeenCalledWith({
      where: { id: CATEGORY_ID },
      data: { writeAccessKind: 'TIERS' },
    })
    expect(tierWriteCreateMany).toHaveBeenCalledWith({
      data: [{ categoryId: CATEGORY_ID, tierId: TIER_ID }],
      skipDuplicates: true,
    })
    expect(groupWriteCreateMany).not.toHaveBeenCalled()
    expect(userWriteCreateMany).not.toHaveBeenCalled()
  })

  it('algún tierId no pertenece al place: { ok:false, error:tier_not_in_place }', async () => {
    mockOwnerHappy()
    tierFindMany.mockResolvedValue([{ id: TIER_ID }])
    const result = await setLibraryCategoryWriteScopeAction({
      categoryId: CATEGORY_ID,
      kind: 'TIERS',
      tierIds: [TIER_ID, 'tier-otro-place'],
    })
    expect(result).toEqual({ ok: false, error: 'tier_not_in_place' })
    expect(transactionFn).not.toHaveBeenCalled()
  })
})

describe('setLibraryCategoryWriteScopeAction — kind=USERS', () => {
  it('valida memberships activas + crea user rows + setea kind', async () => {
    mockOwnerHappy()
    membershipFindMany.mockResolvedValue([{ userId: MEMBER_ID }])

    const result = await setLibraryCategoryWriteScopeAction({
      categoryId: CATEGORY_ID,
      kind: 'USERS',
      userIds: [MEMBER_ID],
    })

    expect(result).toEqual({ ok: true })
    expect(membershipFindMany).toHaveBeenCalledWith({
      where: { placeId: PLACE_ID, userId: { in: [MEMBER_ID] }, leftAt: null },
      select: { userId: true },
    })
    expect(libraryCategoryUpdate).toHaveBeenCalledWith({
      where: { id: CATEGORY_ID },
      data: { writeAccessKind: 'USERS' },
    })
    expect(userWriteCreateMany).toHaveBeenCalledWith({
      data: [{ categoryId: CATEGORY_ID, userId: MEMBER_ID }],
      skipDuplicates: true,
    })
    expect(groupWriteCreateMany).not.toHaveBeenCalled()
    expect(tierWriteCreateMany).not.toHaveBeenCalled()
  })

  it('algún userId no es miembro activo: { ok:false, error:member_not_in_place }', async () => {
    mockOwnerHappy()
    membershipFindMany.mockResolvedValue([{ userId: MEMBER_ID }])
    const result = await setLibraryCategoryWriteScopeAction({
      categoryId: CATEGORY_ID,
      kind: 'USERS',
      userIds: [MEMBER_ID, 'user-no-member'],
    })
    expect(result).toEqual({ ok: false, error: 'member_not_in_place' })
    expect(transactionFn).not.toHaveBeenCalled()
  })
})
