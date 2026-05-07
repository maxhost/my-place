import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

const requireAuthUserIdFn = vi.fn()
const findPlaceOwnershipFn = vi.fn()
const loadPlaceByIdFn = vi.fn()
const permissionGroupFindUnique = vi.fn()
const permissionGroupFindFirst = vi.fn()
const permissionGroupUpdate = vi.fn()
const groupCategoryScopeDeleteMany = vi.fn()
const groupCategoryScopeCreateMany = vi.fn()
const txFn = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    permissionGroup: {
      findUnique: (...a: unknown[]) => permissionGroupFindUnique(...a),
      findFirst: (...a: unknown[]) => permissionGroupFindFirst(...a),
      update: (...a: unknown[]) => permissionGroupUpdate(...a),
    },
    groupCategoryScope: {
      deleteMany: (...a: unknown[]) => groupCategoryScopeDeleteMany(...a),
      createMany: (...a: unknown[]) => groupCategoryScopeCreateMany(...a),
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => {
      txFn(fn)
      const tx = {
        permissionGroup: { update: permissionGroupUpdate },
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

import { updateGroupAction } from '../server/actions/update-group'

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'palermo'
const ACTOR_ID = 'user-owner'
const GROUP_ID = 'grp-1'
const PRESET_GROUP_ID = 'grp-preset'

const PLACE_FIXTURE = {
  id: PLACE_ID,
  slug: PLACE_SLUG,
  name: 'Palermo',
  archivedAt: null,
}

const NORMAL_GROUP = {
  id: GROUP_ID,
  placeId: PLACE_ID,
  name: 'Mods',
  isPreset: false,
  permissions: ['flags:review'],
  categoryScopes: [],
}

const PRESET_GROUP = {
  id: PRESET_GROUP_ID,
  placeId: PLACE_ID,
  name: 'Administradores',
  isPreset: true,
  permissions: ['flags:review', 'discussions:hide-post'],
  categoryScopes: [],
}

const VALID_INPUT = {
  groupId: GROUP_ID,
  name: 'Moderadores',
  description: 'Descripción nueva',
  permissions: ['flags:review', 'discussions:hide-post'],
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAuthUserIdFn.mockResolvedValue(ACTOR_ID)
  findPlaceOwnershipFn.mockResolvedValue(true)
  loadPlaceByIdFn.mockResolvedValue(PLACE_FIXTURE)
  permissionGroupFindUnique.mockResolvedValue(NORMAL_GROUP)
  permissionGroupFindFirst.mockResolvedValue(null)
  permissionGroupUpdate.mockResolvedValue(undefined)
  groupCategoryScopeDeleteMany.mockResolvedValue({ count: 0 })
  groupCategoryScopeCreateMany.mockResolvedValue({ count: 0 })
})

describe('updateGroupAction — happy path', () => {
  it('actualiza name, description, permissions y limpia scope', async () => {
    const result = await updateGroupAction(VALID_INPUT)

    expect(result).toEqual({ ok: true })
    expect(permissionGroupUpdate).toHaveBeenCalledTimes(1)
    expect(groupCategoryScopeDeleteMany).toHaveBeenCalledWith({
      where: { groupId: GROUP_ID },
    })
    expect(groupCategoryScopeCreateMany).not.toHaveBeenCalled()
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/groups`)
  })

  it('persiste nuevos categoryScopeIds', async () => {
    await updateGroupAction({
      ...VALID_INPUT,
      categoryScopeIds: ['cat-1', 'cat-2'],
    })
    expect(groupCategoryScopeCreateMany).toHaveBeenCalledTimes(1)
    const call = groupCategoryScopeCreateMany.mock.calls[0]?.[0] as {
      data: Array<{ groupId: string; categoryId: string }>
    }
    expect(call.data).toEqual([
      { groupId: GROUP_ID, categoryId: 'cat-1' },
      { groupId: GROUP_ID, categoryId: 'cat-2' },
    ])
  })
})

describe('updateGroupAction — preset', () => {
  it('cambiar SOLO name + description del preset → ok (mantiene mismas permissions+scope)', async () => {
    permissionGroupFindUnique.mockResolvedValue(PRESET_GROUP)

    const result = await updateGroupAction({
      groupId: PRESET_GROUP_ID,
      name: 'Renombrado',
      description: 'Otra descripción',
      permissions: PRESET_GROUP.permissions, // sin cambios
    })

    expect(result).toEqual({ ok: true })
    expect(permissionGroupUpdate).toHaveBeenCalled()
  })

  it('cambiar permissions del preset → cannot_modify_preset', async () => {
    permissionGroupFindUnique.mockResolvedValue(PRESET_GROUP)

    const result = await updateGroupAction({
      groupId: PRESET_GROUP_ID,
      name: PRESET_GROUP.name,
      permissions: ['flags:review'], // distinto del set actual
    })

    expect(result).toEqual({ ok: false, error: 'cannot_modify_preset' })
    expect(permissionGroupUpdate).not.toHaveBeenCalled()
  })

  it('agregar scope al preset → cannot_modify_preset', async () => {
    permissionGroupFindUnique.mockResolvedValue(PRESET_GROUP)

    const result = await updateGroupAction({
      groupId: PRESET_GROUP_ID,
      name: PRESET_GROUP.name,
      permissions: PRESET_GROUP.permissions,
      categoryScopeIds: ['cat-1'],
    })

    expect(result).toEqual({ ok: false, error: 'cannot_modify_preset' })
  })
})

describe('updateGroupAction — discriminated union', () => {
  it('name colisiona case-insensitive con otro grupo del place → group_name_taken', async () => {
    permissionGroupFindFirst.mockResolvedValue({ id: 'grp-other' })

    const result = await updateGroupAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'group_name_taken' })
    expect(permissionGroupUpdate).not.toHaveBeenCalled()
  })

  it('grupo no existe → NotFoundError', async () => {
    permissionGroupFindUnique.mockResolvedValue(null)
    await expect(updateGroupAction(VALID_INPUT)).rejects.toThrow(NotFoundError)
  })
})

describe('updateGroupAction — gates', () => {
  it('actor sin ownership → AuthorizationError', async () => {
    findPlaceOwnershipFn.mockResolvedValue(false)
    await expect(updateGroupAction(VALID_INPUT)).rejects.toThrow(AuthorizationError)
  })

  it('place archivado → NotFoundError', async () => {
    loadPlaceByIdFn.mockResolvedValue({ ...PLACE_FIXTURE, archivedAt: new Date() })
    await expect(updateGroupAction(VALID_INPUT)).rejects.toThrow(NotFoundError)
  })
})

describe('updateGroupAction — validación Zod', () => {
  it('groupId vacío → ValidationError', async () => {
    await expect(updateGroupAction({ ...VALID_INPUT, groupId: '' })).rejects.toThrow(
      ValidationError,
    )
  })

  it('name vacío post-trim → ValidationError', async () => {
    await expect(updateGroupAction({ ...VALID_INPUT, name: '   ' })).rejects.toThrow(
      ValidationError,
    )
  })

  it('permissions con string fuera del enum → ValidationError', async () => {
    await expect(updateGroupAction({ ...VALID_INPUT, permissions: ['evil:exec'] })).rejects.toThrow(
      ValidationError,
    )
  })
})
