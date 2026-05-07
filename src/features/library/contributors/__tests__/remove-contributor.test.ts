import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Test para `removeContributorAction` (R.7.2 — M3 batch).
 * Replica el patrón de `archive-category.test.ts`: mocks granulares de
 * Prisma + Supabase auth + `next/cache`, helper local `mockActiveMember`,
 * imports de la action al final (hoisting de `vi.mock`).
 */

// ---------------------------------------------------------------
// Prisma + auxiliares mockeados
// ---------------------------------------------------------------

const libraryCategoryFindUnique = vi.fn()
const libraryCategoryContributorDeleteMany = vi.fn()
const placeFindUnique = vi.fn()
const membershipFindFirst = vi.fn()
const ownershipFindUnique = vi.fn()
const userFindUnique = vi.fn()
const getUserFn = vi.fn()
const revalidatePathFn = vi.fn()
// G.3: hasPermission cae a `prisma.groupMembership.findMany` cuando el
// fallback role===ADMIN no aplica. Default [] (sin grupos).
const groupMembershipFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[])
// C.2: `findIsPlaceAdmin` (identity-cache) usa `findFirst` para chequear
// membership al preset group. Default null (no admin).
const groupMembershipFindFirst = vi.fn(async (..._a: unknown[]) => null as unknown)

vi.mock('@/db/client', () => ({
  prisma: {
    libraryCategory: {
      findUnique: (...a: unknown[]) => libraryCategoryFindUnique(...a),
    },
    libraryCategoryContributor: {
      deleteMany: (...a: unknown[]) => libraryCategoryContributorDeleteMany(...a),
    },
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
    membership: { findFirst: (...a: unknown[]) => membershipFindFirst(...a) },
    placeOwnership: { findUnique: (...a: unknown[]) => ownershipFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    groupMembership: {
      findMany: (...a: unknown[]) => groupMembershipFindMany(...a),
      findFirst: (...a: unknown[]) => groupMembershipFindFirst(...a),
    },
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

// ---------------------------------------------------------------
// Imports después del setup (hoisting de vi.mock)
// ---------------------------------------------------------------

import { removeContributorAction } from '@/features/library/contributors/server/actions/remove-contributor'
import { PERMISSIONS_ALL } from '@/features/groups/public'

// ---------------------------------------------------------------
// Fixtures + helper
// ---------------------------------------------------------------

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'the-place'
const ACTOR_USER_ID = 'user-1'
const TARGET_USER_ID = 'user-target'
const CATEGORY_ID = 'cat-1'
const CATEGORY_SLUG = 'recetas'

type ActorOpts = {
  asAdmin?: boolean
  isOwner?: boolean
}

function mockActiveMember(opts: ActorOpts = {}): void {
  getUserFn.mockResolvedValue({ data: { user: { id: ACTOR_USER_ID } } })
  placeFindUnique.mockResolvedValue({
    id: PLACE_ID,
    slug: PLACE_SLUG,
    name: 'The Place',
    archivedAt: null,
    themeConfig: null,
    openingHours: null,
  })
  membershipFindFirst.mockResolvedValue({ id: 'm-1' })
  ownershipFindUnique.mockResolvedValue(opts.isOwner ? { userId: ACTOR_USER_ID } : null)
  userFindUnique.mockResolvedValue({ displayName: 'Max', avatarUrl: null })
  // C.2: si opts.asAdmin, simular membership al preset group con TODOS los
  // permisos para que `hasPermission` retorne true y `findIsPlaceAdmin`
  // retorne true sin depender del fallback `role === 'ADMIN'` (drop en C.3).
  if (opts.asAdmin) {
    groupMembershipFindMany.mockResolvedValue([
      { group: { id: 'grp-mock-admin', permissions: PERMISSIONS_ALL, categoryScopes: [] } },
    ])
    groupMembershipFindFirst.mockResolvedValue({ id: 'gm-mock-admin' })
  } else {
    groupMembershipFindMany.mockResolvedValue([])
    groupMembershipFindFirst.mockResolvedValue(null)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe('removeContributorAction — happy path', () => {
  it('admin: contributor removido + revalida los 3 paths', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
    })
    libraryCategoryContributorDeleteMany.mockResolvedValue({ count: 1 })

    const result = await removeContributorAction({
      categoryId: CATEGORY_ID,
      userId: TARGET_USER_ID,
    })

    expect(result).toEqual({ ok: true, alreadyRemoved: false })
    expect(libraryCategoryContributorDeleteMany).toHaveBeenCalledTimes(1)
    expect(libraryCategoryContributorDeleteMany).toHaveBeenCalledWith({
      where: { categoryId: CATEGORY_ID, userId: TARGET_USER_ID },
    })
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library/${CATEGORY_SLUG}`)
  })
})

describe('removeContributorAction — autorización', () => {
  it('member común (no admin, no owner): AuthorizationError sin tocar deleteMany', async () => {
    mockActiveMember()
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
    })

    await expect(
      removeContributorAction({ categoryId: CATEGORY_ID, userId: TARGET_USER_ID }),
    ).rejects.toBeInstanceOf(AuthorizationError)

    expect(libraryCategoryContributorDeleteMany).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })
})

describe('removeContributorAction — errores estructurales', () => {
  it('categoría inexistente: NotFoundError antes de resolver actor', async () => {
    libraryCategoryFindUnique.mockResolvedValue(null)

    await expect(
      removeContributorAction({ categoryId: 'cat-missing', userId: TARGET_USER_ID }),
    ).rejects.toBeInstanceOf(NotFoundError)

    expect(getUserFn).not.toHaveBeenCalled()
    expect(placeFindUnique).not.toHaveBeenCalled()
    expect(libraryCategoryContributorDeleteMany).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })

  it('input mal formado (sin userId): ValidationError sin tocar Prisma', async () => {
    await expect(removeContributorAction({ categoryId: CATEGORY_ID })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(libraryCategoryFindUnique).not.toHaveBeenCalled()
    expect(libraryCategoryContributorDeleteMany).not.toHaveBeenCalled()
  })
})

describe('removeContributorAction — idempotencia', () => {
  it('contributor no existe (count: 0): retorna alreadyRemoved=true sin error y revalida igual', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
    })
    libraryCategoryContributorDeleteMany.mockResolvedValue({ count: 0 })

    const result = await removeContributorAction({
      categoryId: CATEGORY_ID,
      userId: TARGET_USER_ID,
    })

    expect(result).toEqual({ ok: true, alreadyRemoved: true })
    expect(libraryCategoryContributorDeleteMany).toHaveBeenCalledTimes(1)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library/${CATEGORY_SLUG}`)
  })
})
