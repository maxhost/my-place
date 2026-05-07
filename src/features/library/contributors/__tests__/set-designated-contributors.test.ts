import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Tests para `setLibraryCategoryDesignatedContributorsAction` (F.5 —
 * picker inline DESIGNATED). Mirror semántico de
 * `set-category-group-scope.test.ts` pero para users en vez de groups.
 */

const libraryCategoryFindUnique = vi.fn()
const placeFindUnique = vi.fn()
const ownershipFindUnique = vi.fn()
const membershipFindFirst = vi.fn()
const membershipFindMany = vi.fn()
const userFindUnique = vi.fn()
const groupMembershipFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[])
const groupMembershipFindFirst = vi.fn(async (..._a: unknown[]) => null as unknown)
const libraryCategoryContributorDeleteMany = vi.fn()
const libraryCategoryContributorCreateMany = vi.fn()
const transactionFn = vi.fn()
const getUserFn = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    libraryCategory: { findUnique: (...a: unknown[]) => libraryCategoryFindUnique(...a) },
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
    placeOwnership: { findUnique: (...a: unknown[]) => ownershipFindUnique(...a) },
    membership: {
      findFirst: (...a: unknown[]) => membershipFindFirst(...a),
      findMany: (...a: unknown[]) => membershipFindMany(...a),
    },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    groupMembership: {
      findMany: (...a: unknown[]) => groupMembershipFindMany(...a),
      findFirst: (...a: unknown[]) => groupMembershipFindFirst(...a),
    },
    libraryCategoryContributor: {
      deleteMany: (...a: unknown[]) => libraryCategoryContributorDeleteMany(...a),
      createMany: (...a: unknown[]) => libraryCategoryContributorCreateMany(...a),
    },
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

import { setLibraryCategoryDesignatedContributorsAction } from '@/features/library/contributors/server/actions/set-designated-contributors'
import { PERMISSIONS_ALL } from '@/features/groups/public'

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'the-place'
const CATEGORY_ID = 'cat-1'
const CATEGORY_SLUG = 'recetas'
const ACTOR_ID = 'user-1'
const MEMBER_A = 'user-a'
const MEMBER_B = 'user-b'

function mockHappyAdmin(): void {
  getUserFn.mockResolvedValue({ data: { user: { id: ACTOR_ID } } })
  libraryCategoryFindUnique.mockResolvedValue({
    id: CATEGORY_ID,
    placeId: PLACE_ID,
    slug: CATEGORY_SLUG,
    archivedAt: null,
  })
  placeFindUnique.mockResolvedValue({
    id: PLACE_ID,
    slug: PLACE_SLUG,
    name: 'The Place',
    archivedAt: null,
    themeConfig: null,
    openingHours: null,
  })
  membershipFindFirst.mockResolvedValue({ id: 'mem-1' })
  ownershipFindUnique.mockResolvedValue({ userId: ACTOR_ID })
  userFindUnique.mockResolvedValue({ displayName: 'Max', avatarUrl: null })
  // hasPermission('library:moderate-categories') — admin via preset group.
  groupMembershipFindMany.mockResolvedValue([
    { group: { id: 'grp-mock-admin', permissions: PERMISSIONS_ALL, categoryScopes: [] } },
  ])
  groupMembershipFindFirst.mockResolvedValue({ id: 'gm-mock-admin' })
  transactionFn.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      libraryCategoryContributor: {
        deleteMany: libraryCategoryContributorDeleteMany,
        createMany: libraryCategoryContributorCreateMany,
      },
    }),
  )
  libraryCategoryContributorDeleteMany.mockResolvedValue({ count: 0 })
  libraryCategoryContributorCreateMany.mockResolvedValue({ count: 0 })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('setLibraryCategoryDesignatedContributorsAction — validación + auth', () => {
  it('rechaza input inválido con ValidationError', async () => {
    await expect(
      setLibraryCategoryDesignatedContributorsAction({ categoryId: '', userIds: [] }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(getUserFn).not.toHaveBeenCalled()
  })

  it('rechaza categoría inexistente con NotFoundError', async () => {
    libraryCategoryFindUnique.mockResolvedValue(null)
    await expect(
      setLibraryCategoryDesignatedContributorsAction({ categoryId: 'cat-x', userIds: [] }),
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
      setLibraryCategoryDesignatedContributorsAction({ categoryId: CATEGORY_ID, userIds: [] }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rechaza no-admin sin perm con AuthorizationError', async () => {
    getUserFn.mockResolvedValue({ data: { user: { id: ACTOR_ID } } })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
      archivedAt: null,
    })
    placeFindUnique.mockResolvedValue({
      id: PLACE_ID,
      slug: PLACE_SLUG,
      name: 'X',
      archivedAt: null,
      themeConfig: null,
      openingHours: null,
    })
    membershipFindFirst.mockResolvedValue({ id: 'mem-1' })
    ownershipFindUnique.mockResolvedValue(null)
    // member común sin perm.
    groupMembershipFindMany.mockResolvedValue([])
    groupMembershipFindFirst.mockResolvedValue(null)
    userFindUnique.mockResolvedValue({ displayName: 'X', avatarUrl: null })

    await expect(
      setLibraryCategoryDesignatedContributorsAction({ categoryId: CATEGORY_ID, userIds: [] }),
    ).rejects.toBeInstanceOf(AuthorizationError)
    expect(transactionFn).not.toHaveBeenCalled()
  })
})

describe('setLibraryCategoryDesignatedContributorsAction — happy paths', () => {
  it('admin con userIds=[] borra contributors existentes sin createMany (idempotente)', async () => {
    mockHappyAdmin()

    const result = await setLibraryCategoryDesignatedContributorsAction({
      categoryId: CATEGORY_ID,
      userIds: [],
    })

    expect(result).toEqual({ ok: true })
    expect(libraryCategoryContributorDeleteMany).toHaveBeenCalledWith({
      where: { categoryId: CATEGORY_ID },
    })
    expect(libraryCategoryContributorCreateMany).not.toHaveBeenCalled()
    expect(membershipFindMany).not.toHaveBeenCalled() // skip valid
  })

  it('admin con N userIds: valida pertenencia, borra y crea con invitedByUserId=actor', async () => {
    mockHappyAdmin()
    membershipFindMany.mockResolvedValue([{ userId: MEMBER_A }, { userId: MEMBER_B }])

    const result = await setLibraryCategoryDesignatedContributorsAction({
      categoryId: CATEGORY_ID,
      userIds: [MEMBER_A, MEMBER_B],
    })

    expect(result).toEqual({ ok: true })
    expect(membershipFindMany).toHaveBeenCalledWith({
      where: {
        placeId: PLACE_ID,
        userId: { in: [MEMBER_A, MEMBER_B] },
        leftAt: null,
      },
      select: { userId: true },
    })
    expect(libraryCategoryContributorDeleteMany).toHaveBeenCalled()
    expect(libraryCategoryContributorCreateMany).toHaveBeenCalledWith({
      data: [
        { categoryId: CATEGORY_ID, userId: MEMBER_A, invitedByUserId: ACTOR_ID },
        { categoryId: CATEGORY_ID, userId: MEMBER_B, invitedByUserId: ACTOR_ID },
      ],
      skipDuplicates: true,
    })
  })

  it('dedupe userIds duplicados en el input', async () => {
    mockHappyAdmin()
    membershipFindMany.mockResolvedValue([{ userId: MEMBER_A }])

    await setLibraryCategoryDesignatedContributorsAction({
      categoryId: CATEGORY_ID,
      userIds: [MEMBER_A, MEMBER_A, MEMBER_A],
    })

    expect(membershipFindMany).toHaveBeenCalledWith({
      where: {
        placeId: PLACE_ID,
        userId: { in: [MEMBER_A] },
        leftAt: null,
      },
      select: { userId: true },
    })
    expect(libraryCategoryContributorCreateMany).toHaveBeenCalledWith({
      data: [{ categoryId: CATEGORY_ID, userId: MEMBER_A, invitedByUserId: ACTOR_ID }],
      skipDuplicates: true,
    })
  })
})

describe('setLibraryCategoryDesignatedContributorsAction — invariantes de payload', () => {
  it('userIds que no son miembros activos: { ok: false, error: member_not_in_place }', async () => {
    mockHappyAdmin()
    // 2 userIds pero solo 1 matchea membership activa → mismatch.
    membershipFindMany.mockResolvedValue([{ userId: MEMBER_A }])

    const result = await setLibraryCategoryDesignatedContributorsAction({
      categoryId: CATEGORY_ID,
      userIds: [MEMBER_A, 'user-ex-miembro'],
    })

    expect(result).toEqual({ ok: false, error: 'member_not_in_place' })
    expect(transactionFn).not.toHaveBeenCalled()
    expect(libraryCategoryContributorDeleteMany).not.toHaveBeenCalled()
  })
})
