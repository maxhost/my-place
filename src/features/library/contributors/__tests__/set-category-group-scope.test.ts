import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Tests para `setLibraryCategoryGroupScopeAction` (F.2 — SELECTED_GROUPS).
 *
 * Action category-centric. NO bloquea preset (decisión #B ADR
 * `2026-05-04-library-contribution-policy-groups.md`) — diferencia clave
 * con `groups/setGroupCategoryScopeAction`.
 */

const libraryCategoryFindUnique = vi.fn()
const placeFindUnique = vi.fn()
const ownershipFindUnique = vi.fn()
const permissionGroupFindMany = vi.fn()
const groupCategoryScopeDeleteMany = vi.fn()
const groupCategoryScopeCreateMany = vi.fn()
const transactionFn = vi.fn()
const getUserFn = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    libraryCategory: { findUnique: (...a: unknown[]) => libraryCategoryFindUnique(...a) },
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
    placeOwnership: { findUnique: (...a: unknown[]) => ownershipFindUnique(...a) },
    permissionGroup: { findMany: (...a: unknown[]) => permissionGroupFindMany(...a) },
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

import { setLibraryCategoryGroupScopeAction } from '@/features/library/contributors/server/actions/set-category-group-scope'

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'the-place'
const CATEGORY_ID = 'cat-1'
const CATEGORY_SLUG = 'recetas'
const ACTOR_ID = 'user-1'
const PRESET_GROUP_ID = 'grp-preset-admins'
const CUSTOM_GROUP_ID = 'grp-mods'

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
  // Default: tx ejecuta la callback con un fake `tx` que tiene los métodos
  // escritos por el action.
  transactionFn.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      groupCategoryScope: {
        deleteMany: groupCategoryScopeDeleteMany,
        createMany: groupCategoryScopeCreateMany,
      },
    }),
  )
  groupCategoryScopeDeleteMany.mockResolvedValue({ count: 0 })
  groupCategoryScopeCreateMany.mockResolvedValue({ count: 0 })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('setLibraryCategoryGroupScopeAction — validación + auth', () => {
  it('rechaza input inválido con ValidationError', async () => {
    await expect(
      setLibraryCategoryGroupScopeAction({ categoryId: '', groupIds: [] }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(getUserFn).not.toHaveBeenCalled()
  })

  it('rechaza sin sesión con AuthorizationError', async () => {
    getUserFn.mockResolvedValue({ data: { user: null } })
    await expect(
      setLibraryCategoryGroupScopeAction({ categoryId: CATEGORY_ID, groupIds: [] }),
    ).rejects.toBeInstanceOf(AuthorizationError)
    expect(libraryCategoryFindUnique).not.toHaveBeenCalled()
  })

  it('rechaza categoría inexistente con NotFoundError', async () => {
    getUserFn.mockResolvedValue({ data: { user: { id: ACTOR_ID } } })
    libraryCategoryFindUnique.mockResolvedValue(null)
    await expect(
      setLibraryCategoryGroupScopeAction({ categoryId: 'cat-x', groupIds: [] }),
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
      setLibraryCategoryGroupScopeAction({ categoryId: CATEGORY_ID, groupIds: [] }),
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
      setLibraryCategoryGroupScopeAction({ categoryId: CATEGORY_ID, groupIds: [] }),
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
    ownershipFindUnique.mockResolvedValue(null) // no es owner
    await expect(
      setLibraryCategoryGroupScopeAction({ categoryId: CATEGORY_ID, groupIds: [] }),
    ).rejects.toBeInstanceOf(AuthorizationError)
    expect(transactionFn).not.toHaveBeenCalled()
  })
})

describe('setLibraryCategoryGroupScopeAction — happy paths', () => {
  it('owner con groupIds=[] borra scope existente sin createMany (idempotente)', async () => {
    mockOwnerHappy()

    const result = await setLibraryCategoryGroupScopeAction({
      categoryId: CATEGORY_ID,
      groupIds: [],
    })

    expect(result).toEqual({ ok: true })
    expect(groupCategoryScopeDeleteMany).toHaveBeenCalledWith({
      where: { categoryId: CATEGORY_ID },
    })
    expect(groupCategoryScopeCreateMany).not.toHaveBeenCalled()
    expect(permissionGroupFindMany).not.toHaveBeenCalled() // skip valid
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/library`)
  })

  it('owner con groupIds custom: valida pertenencia, borra y crea', async () => {
    mockOwnerHappy()
    permissionGroupFindMany.mockResolvedValue([{ id: CUSTOM_GROUP_ID }])

    const result = await setLibraryCategoryGroupScopeAction({
      categoryId: CATEGORY_ID,
      groupIds: [CUSTOM_GROUP_ID],
    })

    expect(result).toEqual({ ok: true })
    expect(permissionGroupFindMany).toHaveBeenCalledWith({
      where: { id: { in: [CUSTOM_GROUP_ID] }, placeId: PLACE_ID },
      select: { id: true },
    })
    expect(groupCategoryScopeDeleteMany).toHaveBeenCalled()
    expect(groupCategoryScopeCreateMany).toHaveBeenCalledWith({
      data: [{ groupId: CUSTOM_GROUP_ID, categoryId: CATEGORY_ID }],
      skipDuplicates: true,
    })
  })

  it('preset Administradores PERMITIDO (decisión #B ADR 2026-05-04) — NO bloquea', async () => {
    mockOwnerHappy()
    permissionGroupFindMany.mockResolvedValue([{ id: PRESET_GROUP_ID }])

    const result = await setLibraryCategoryGroupScopeAction({
      categoryId: CATEGORY_ID,
      groupIds: [PRESET_GROUP_ID],
    })

    expect(result).toEqual({ ok: true })
    expect(groupCategoryScopeCreateMany).toHaveBeenCalledWith({
      data: [{ groupId: PRESET_GROUP_ID, categoryId: CATEGORY_ID }],
      skipDuplicates: true,
    })
  })

  it('combina preset + custom en un solo set', async () => {
    mockOwnerHappy()
    permissionGroupFindMany.mockResolvedValue([{ id: PRESET_GROUP_ID }, { id: CUSTOM_GROUP_ID }])

    await setLibraryCategoryGroupScopeAction({
      categoryId: CATEGORY_ID,
      groupIds: [PRESET_GROUP_ID, CUSTOM_GROUP_ID],
    })

    expect(groupCategoryScopeCreateMany).toHaveBeenCalledWith({
      data: [
        { groupId: PRESET_GROUP_ID, categoryId: CATEGORY_ID },
        { groupId: CUSTOM_GROUP_ID, categoryId: CATEGORY_ID },
      ],
      skipDuplicates: true,
    })
  })

  it('dedupe de groupIds duplicados en el input', async () => {
    mockOwnerHappy()
    permissionGroupFindMany.mockResolvedValue([{ id: CUSTOM_GROUP_ID }])

    await setLibraryCategoryGroupScopeAction({
      categoryId: CATEGORY_ID,
      groupIds: [CUSTOM_GROUP_ID, CUSTOM_GROUP_ID, CUSTOM_GROUP_ID],
    })

    expect(permissionGroupFindMany).toHaveBeenCalledWith({
      where: { id: { in: [CUSTOM_GROUP_ID] }, placeId: PLACE_ID },
      select: { id: true },
    })
    expect(groupCategoryScopeCreateMany).toHaveBeenCalledWith({
      data: [{ groupId: CUSTOM_GROUP_ID, categoryId: CATEGORY_ID }],
      skipDuplicates: true,
    })
  })
})

describe('setLibraryCategoryGroupScopeAction — invariantes de payload', () => {
  it('groupIds que no pertenecen al place: { ok: false, error: group_not_in_place }', async () => {
    mockOwnerHappy()
    // Pasamos 2 groupIds pero solo 1 existe en el place → mismatch.
    permissionGroupFindMany.mockResolvedValue([{ id: CUSTOM_GROUP_ID }])

    const result = await setLibraryCategoryGroupScopeAction({
      categoryId: CATEGORY_ID,
      groupIds: [CUSTOM_GROUP_ID, 'grp-otro-place'],
    })

    expect(result).toEqual({ ok: false, error: 'group_not_in_place' })
    expect(transactionFn).not.toHaveBeenCalled()
    expect(groupCategoryScopeDeleteMany).not.toHaveBeenCalled()
  })
})
