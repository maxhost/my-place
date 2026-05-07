import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

const requireAuthUserIdFn = vi.fn()
const findPlaceOwnershipFn = vi.fn()
const loadPlaceByIdFn = vi.fn()
const permissionGroupFindUnique = vi.fn()
const libraryCategoryFindMany = vi.fn()
const groupCategoryScopeDeleteMany = vi.fn()
const groupCategoryScopeCreateMany = vi.fn()
const txFn = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    permissionGroup: {
      findUnique: (...a: unknown[]) => permissionGroupFindUnique(...a),
    },
    libraryCategory: {
      findMany: (...a: unknown[]) => libraryCategoryFindMany(...a),
    },
    groupCategoryScope: {
      deleteMany: (...a: unknown[]) => groupCategoryScopeDeleteMany(...a),
      createMany: (...a: unknown[]) => groupCategoryScopeCreateMany(...a),
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => {
      txFn(fn)
      const tx = {
        groupCategoryScope: {
          deleteMany: groupCategoryScopeDeleteMany,
          createMany: groupCategoryScopeCreateMany,
        },
      }
      return fn(tx)
    },
  },
}))

vi.mock('@/shared/lib/auth-user', () => ({
  requireAuthUserId: (...a: unknown[]) => requireAuthUserIdFn(...a),
}))

vi.mock('@/shared/lib/identity-cache', () => ({
  findPlaceOwnership: (...a: unknown[]) => findPlaceOwnershipFn(...a),
}))

vi.mock('@/shared/lib/place-loader', () => ({
  loadPlaceById: (...a: unknown[]) => loadPlaceByIdFn(...a),
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
}))

vi.mock('server-only', () => ({}))

import { setGroupCategoryScopeAction } from '@/features/groups/category-scope/server/actions/set-group-category-scope'

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'palermo'
const ACTOR_ID = 'user-owner'
const GROUP_ID = 'grp-1'

const PLACE_FIXTURE = {
  id: PLACE_ID,
  slug: PLACE_SLUG,
  name: 'Palermo',
  archivedAt: null,
}

const NORMAL_GROUP = {
  id: GROUP_ID,
  placeId: PLACE_ID,
  name: 'Library Mods',
  isPreset: false,
}

const PRESET_GROUP = {
  id: 'grp-preset',
  placeId: PLACE_ID,
  name: 'Administradores',
  isPreset: true,
}

const VALID_INPUT = { groupId: GROUP_ID, categoryIds: ['cat-1', 'cat-2'] }

beforeEach(() => {
  vi.clearAllMocks()
  requireAuthUserIdFn.mockResolvedValue(ACTOR_ID)
  findPlaceOwnershipFn.mockResolvedValue(true)
  loadPlaceByIdFn.mockResolvedValue(PLACE_FIXTURE)
  permissionGroupFindUnique.mockResolvedValue(NORMAL_GROUP)
  libraryCategoryFindMany.mockResolvedValue([{ id: 'cat-1' }, { id: 'cat-2' }])
  groupCategoryScopeDeleteMany.mockResolvedValue({ count: 0 })
  groupCategoryScopeCreateMany.mockResolvedValue({ count: 2 })
})

describe('setGroupCategoryScopeAction — happy path', () => {
  it('sync delete + createMany del nuevo set', async () => {
    const result = await setGroupCategoryScopeAction(VALID_INPUT)

    expect(result).toEqual({ ok: true })
    expect(groupCategoryScopeDeleteMany).toHaveBeenCalledWith({
      where: { groupId: GROUP_ID },
    })
    const createCall = groupCategoryScopeCreateMany.mock.calls[0]?.[0] as {
      data: Array<{ groupId: string; categoryId: string }>
    }
    expect(createCall.data).toEqual([
      { groupId: GROUP_ID, categoryId: 'cat-1' },
      { groupId: GROUP_ID, categoryId: 'cat-2' },
    ])
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/groups`)
  })

  it('categoryIds vacío deja al grupo en scope global (delete sin create)', async () => {
    await setGroupCategoryScopeAction({ groupId: GROUP_ID, categoryIds: [] })

    expect(groupCategoryScopeDeleteMany).toHaveBeenCalled()
    expect(groupCategoryScopeCreateMany).not.toHaveBeenCalled()
  })

  it('dedupea ids antes de validar y persistir', async () => {
    libraryCategoryFindMany.mockResolvedValue([{ id: 'cat-1' }])

    const result = await setGroupCategoryScopeAction({
      groupId: GROUP_ID,
      categoryIds: ['cat-1', 'cat-1', 'cat-1'],
    })

    expect(result).toEqual({ ok: true })
    const findCall = libraryCategoryFindMany.mock.calls[0]?.[0] as {
      where: { id: { in: string[] } }
    }
    expect(findCall.where.id.in).toEqual(['cat-1'])
  })
})

describe('setGroupCategoryScopeAction — discriminated union', () => {
  it('preset → cannot_scope_preset', async () => {
    permissionGroupFindUnique.mockResolvedValue(PRESET_GROUP)

    const result = await setGroupCategoryScopeAction({
      groupId: 'grp-preset',
      categoryIds: ['cat-1'],
    })

    expect(result).toEqual({ ok: false, error: 'cannot_scope_preset' })
    expect(groupCategoryScopeDeleteMany).not.toHaveBeenCalled()
  })

  it('alguno de los categoryIds NO pertenece al place → category_not_in_place', async () => {
    libraryCategoryFindMany.mockResolvedValue([{ id: 'cat-1' }]) // falta cat-2

    const result = await setGroupCategoryScopeAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'category_not_in_place' })
    expect(groupCategoryScopeDeleteMany).not.toHaveBeenCalled()
  })

  it('grupo no existe → NotFoundError', async () => {
    permissionGroupFindUnique.mockResolvedValue(null)
    await expect(setGroupCategoryScopeAction(VALID_INPUT)).rejects.toThrow(NotFoundError)
  })
})

describe('setGroupCategoryScopeAction — gates', () => {
  it('actor sin ownership → AuthorizationError', async () => {
    findPlaceOwnershipFn.mockResolvedValue(false)
    await expect(setGroupCategoryScopeAction(VALID_INPUT)).rejects.toThrow(AuthorizationError)
  })

  it('place archivado → NotFoundError', async () => {
    loadPlaceByIdFn.mockResolvedValue({ ...PLACE_FIXTURE, archivedAt: new Date() })
    await expect(setGroupCategoryScopeAction(VALID_INPUT)).rejects.toThrow(NotFoundError)
  })
})

describe('setGroupCategoryScopeAction — validación Zod', () => {
  it('groupId vacío → ValidationError', async () => {
    await expect(setGroupCategoryScopeAction({ groupId: '', categoryIds: [] })).rejects.toThrow(
      ValidationError,
    )
  })

  it('categoryIds no array → ValidationError', async () => {
    await expect(
      setGroupCategoryScopeAction({ groupId: GROUP_ID, categoryIds: 'cat-1' }),
    ).rejects.toThrow(ValidationError)
  })
})
