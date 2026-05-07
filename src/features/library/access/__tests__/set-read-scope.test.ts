import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Tests para `setLibraryCategoryReadScopeAction` (G.2.a — read access scopes).
 *
 * Action category-centric. Owner-only. Override completo: borra todas
 * las rows de las 3 tablas + recrea sólo la del kind elegido + setea
 * `LibraryCategory.readAccessKind`.
 *
 * Discriminated union return:
 *  - { ok: true }
 *  - { ok: false, error: 'group_not_in_place' | 'tier_not_in_place' | 'member_not_in_place' }
 */

const libraryCategoryFindUnique = vi.fn()
const libraryCategoryUpdate = vi.fn()
const placeFindUnique = vi.fn()
const ownershipFindUnique = vi.fn()
const permissionGroupFindMany = vi.fn()
const tierFindMany = vi.fn()
const membershipFindMany = vi.fn()
const groupReadDeleteMany = vi.fn()
const groupReadCreateMany = vi.fn()
const tierReadDeleteMany = vi.fn()
const tierReadCreateMany = vi.fn()
const userReadDeleteMany = vi.fn()
const userReadCreateMany = vi.fn()
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

import { setLibraryCategoryReadScopeAction } from '../server/actions/set-read-scope'

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
  // Tx ejecuta callback con un fake tx que tiene los métodos relevantes.
  transactionFn.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      libraryCategory: {
        update: libraryCategoryUpdate,
      },
      libraryCategoryGroupReadScope: {
        deleteMany: groupReadDeleteMany,
        createMany: groupReadCreateMany,
      },
      libraryCategoryTierReadScope: {
        deleteMany: tierReadDeleteMany,
        createMany: tierReadCreateMany,
      },
      libraryCategoryUserReadScope: {
        deleteMany: userReadDeleteMany,
        createMany: userReadCreateMany,
      },
    }),
  )
  groupReadDeleteMany.mockResolvedValue({ count: 0 })
  groupReadCreateMany.mockResolvedValue({ count: 0 })
  tierReadDeleteMany.mockResolvedValue({ count: 0 })
  tierReadCreateMany.mockResolvedValue({ count: 0 })
  userReadDeleteMany.mockResolvedValue({ count: 0 })
  userReadCreateMany.mockResolvedValue({ count: 0 })
  libraryCategoryUpdate.mockResolvedValue({})
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('setLibraryCategoryReadScopeAction — validación + auth', () => {
  it('rechaza input inválido (sin kind) con ValidationError', async () => {
    await expect(
      setLibraryCategoryReadScopeAction({ categoryId: CATEGORY_ID }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(getUserFn).not.toHaveBeenCalled()
  })

  it('rechaza payload mismatch (kind=GROUPS sin groupIds) con ValidationError', async () => {
    await expect(
      setLibraryCategoryReadScopeAction({ categoryId: CATEGORY_ID, kind: 'GROUPS' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('rechaza payload mismatch (kind=GROUPS con userIds) con ValidationError', async () => {
    await expect(
      setLibraryCategoryReadScopeAction({
        categoryId: CATEGORY_ID,
        kind: 'GROUPS',
        userIds: [MEMBER_ID],
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('rechaza array > 50 entries con ValidationError', async () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `grp-${i}`)
    await expect(
      setLibraryCategoryReadScopeAction({
        categoryId: CATEGORY_ID,
        kind: 'GROUPS',
        groupIds: tooMany,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('rechaza sin sesión con AuthorizationError', async () => {
    getUserFn.mockResolvedValue({ data: { user: null } })
    await expect(
      setLibraryCategoryReadScopeAction({ categoryId: CATEGORY_ID, kind: 'PUBLIC' }),
    ).rejects.toBeInstanceOf(AuthorizationError)
  })

  it('rechaza categoría inexistente con NotFoundError', async () => {
    getUserFn.mockResolvedValue({ data: { user: { id: ACTOR_ID } } })
    libraryCategoryFindUnique.mockResolvedValue(null)
    await expect(
      setLibraryCategoryReadScopeAction({ categoryId: 'cat-x', kind: 'PUBLIC' }),
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
      setLibraryCategoryReadScopeAction({ categoryId: CATEGORY_ID, kind: 'PUBLIC' }),
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
      setLibraryCategoryReadScopeAction({ categoryId: CATEGORY_ID, kind: 'PUBLIC' }),
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
      setLibraryCategoryReadScopeAction({ categoryId: CATEGORY_ID, kind: 'PUBLIC' }),
    ).rejects.toBeInstanceOf(AuthorizationError)
    expect(transactionFn).not.toHaveBeenCalled()
  })
})

describe('setLibraryCategoryReadScopeAction — kind=PUBLIC', () => {
  it('borra los 3 sets + setea kind=PUBLIC, sin createMany', async () => {
    mockOwnerHappy()

    const result = await setLibraryCategoryReadScopeAction({
      categoryId: CATEGORY_ID,
      kind: 'PUBLIC',
    })

    expect(result).toEqual({ ok: true })
    expect(transactionFn).toHaveBeenCalledTimes(1)
    expect(libraryCategoryUpdate).toHaveBeenCalledWith({
      where: { id: CATEGORY_ID },
      data: { readAccessKind: 'PUBLIC' },
    })
    expect(groupReadDeleteMany).toHaveBeenCalledWith({ where: { categoryId: CATEGORY_ID } })
    expect(tierReadDeleteMany).toHaveBeenCalledWith({ where: { categoryId: CATEGORY_ID } })
    expect(userReadDeleteMany).toHaveBeenCalledWith({ where: { categoryId: CATEGORY_ID } })
    expect(groupReadCreateMany).not.toHaveBeenCalled()
    expect(tierReadCreateMany).not.toHaveBeenCalled()
    expect(userReadCreateMany).not.toHaveBeenCalled()
    expect(permissionGroupFindMany).not.toHaveBeenCalled()
    expect(tierFindMany).not.toHaveBeenCalled()
    expect(membershipFindMany).not.toHaveBeenCalled()
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library/${CATEGORY_SLUG}`)
  })
})

describe('setLibraryCategoryReadScopeAction — kind=GROUPS', () => {
  it('valida pertenencia, borra los 3 + crea group rows + setea kind', async () => {
    mockOwnerHappy()
    permissionGroupFindMany.mockResolvedValue([{ id: GROUP_ID }])

    const result = await setLibraryCategoryReadScopeAction({
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
      data: { readAccessKind: 'GROUPS' },
    })
    // Borra los 3 sets (override completo).
    expect(groupReadDeleteMany).toHaveBeenCalled()
    expect(tierReadDeleteMany).toHaveBeenCalled()
    expect(userReadDeleteMany).toHaveBeenCalled()
    // Sólo crea en la tabla del kind elegido.
    expect(groupReadCreateMany).toHaveBeenCalledWith({
      data: [{ categoryId: CATEGORY_ID, groupId: GROUP_ID }],
      skipDuplicates: true,
    })
    expect(tierReadCreateMany).not.toHaveBeenCalled()
    expect(userReadCreateMany).not.toHaveBeenCalled()
  })

  it('groupIds=[] con kind=GROUPS: setea kind, borra todo, no crea', async () => {
    mockOwnerHappy()
    const result = await setLibraryCategoryReadScopeAction({
      categoryId: CATEGORY_ID,
      kind: 'GROUPS',
      groupIds: [],
    })
    expect(result).toEqual({ ok: true })
    expect(permissionGroupFindMany).not.toHaveBeenCalled()
    expect(groupReadCreateMany).not.toHaveBeenCalled()
  })

  it('dedupe groupIds duplicados', async () => {
    mockOwnerHappy()
    permissionGroupFindMany.mockResolvedValue([{ id: GROUP_ID }])
    await setLibraryCategoryReadScopeAction({
      categoryId: CATEGORY_ID,
      kind: 'GROUPS',
      groupIds: [GROUP_ID, GROUP_ID, GROUP_ID],
    })
    expect(permissionGroupFindMany).toHaveBeenCalledWith({
      where: { id: { in: [GROUP_ID] }, placeId: PLACE_ID },
      select: { id: true },
    })
    expect(groupReadCreateMany).toHaveBeenCalledWith({
      data: [{ categoryId: CATEGORY_ID, groupId: GROUP_ID }],
      skipDuplicates: true,
    })
  })

  it('algún groupId no pertenece al place: { ok:false, error:group_not_in_place }', async () => {
    mockOwnerHappy()
    permissionGroupFindMany.mockResolvedValue([{ id: GROUP_ID }])
    const result = await setLibraryCategoryReadScopeAction({
      categoryId: CATEGORY_ID,
      kind: 'GROUPS',
      groupIds: [GROUP_ID, 'grp-otro-place'],
    })
    expect(result).toEqual({ ok: false, error: 'group_not_in_place' })
    expect(transactionFn).not.toHaveBeenCalled()
  })
})

describe('setLibraryCategoryReadScopeAction — kind=TIERS', () => {
  it('valida pertenencia + crea tier rows + setea kind', async () => {
    mockOwnerHappy()
    tierFindMany.mockResolvedValue([{ id: TIER_ID }])

    const result = await setLibraryCategoryReadScopeAction({
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
      data: { readAccessKind: 'TIERS' },
    })
    expect(tierReadCreateMany).toHaveBeenCalledWith({
      data: [{ categoryId: CATEGORY_ID, tierId: TIER_ID }],
      skipDuplicates: true,
    })
    expect(groupReadCreateMany).not.toHaveBeenCalled()
    expect(userReadCreateMany).not.toHaveBeenCalled()
  })

  it('algún tierId no pertenece al place: { ok:false, error:tier_not_in_place }', async () => {
    mockOwnerHappy()
    tierFindMany.mockResolvedValue([{ id: TIER_ID }])
    const result = await setLibraryCategoryReadScopeAction({
      categoryId: CATEGORY_ID,
      kind: 'TIERS',
      tierIds: [TIER_ID, 'tier-otro-place'],
    })
    expect(result).toEqual({ ok: false, error: 'tier_not_in_place' })
    expect(transactionFn).not.toHaveBeenCalled()
  })
})

describe('setLibraryCategoryReadScopeAction — kind=USERS', () => {
  it('valida memberships activas + crea user rows + setea kind', async () => {
    mockOwnerHappy()
    membershipFindMany.mockResolvedValue([{ userId: MEMBER_ID }])

    const result = await setLibraryCategoryReadScopeAction({
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
      data: { readAccessKind: 'USERS' },
    })
    expect(userReadCreateMany).toHaveBeenCalledWith({
      data: [{ categoryId: CATEGORY_ID, userId: MEMBER_ID }],
      skipDuplicates: true,
    })
    expect(groupReadCreateMany).not.toHaveBeenCalled()
    expect(tierReadCreateMany).not.toHaveBeenCalled()
  })

  it('algún userId no es miembro activo: { ok:false, error:member_not_in_place }', async () => {
    mockOwnerHappy()
    membershipFindMany.mockResolvedValue([{ userId: MEMBER_ID }])
    const result = await setLibraryCategoryReadScopeAction({
      categoryId: CATEGORY_ID,
      kind: 'USERS',
      userIds: [MEMBER_ID, 'user-no-member'],
    })
    expect(result).toEqual({ ok: false, error: 'member_not_in_place' })
    expect(transactionFn).not.toHaveBeenCalled()
  })
})
