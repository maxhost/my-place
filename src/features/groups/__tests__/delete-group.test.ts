import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

const requireAuthUserIdFn = vi.fn()
const findPlaceOwnershipFn = vi.fn()
const loadPlaceByIdFn = vi.fn()
const permissionGroupFindUnique = vi.fn()
const permissionGroupDelete = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    permissionGroup: {
      findUnique: (...a: unknown[]) => permissionGroupFindUnique(...a),
      delete: (...a: unknown[]) => permissionGroupDelete(...a),
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

import { deleteGroupAction } from '../server/actions/delete-group'

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

const EMPTY_GROUP = {
  id: GROUP_ID,
  placeId: PLACE_ID,
  name: 'Mods',
  isPreset: false,
  _count: { groupMemberships: 0 },
}

const PRESET_GROUP = {
  id: 'grp-preset',
  placeId: PLACE_ID,
  name: 'Administradores',
  isPreset: true,
  _count: { groupMemberships: 5 },
}

const POPULATED_GROUP = {
  ...EMPTY_GROUP,
  _count: { groupMemberships: 3 },
}

const VALID_INPUT = { groupId: GROUP_ID }

beforeEach(() => {
  vi.clearAllMocks()
  requireAuthUserIdFn.mockResolvedValue(ACTOR_ID)
  findPlaceOwnershipFn.mockResolvedValue(true)
  loadPlaceByIdFn.mockResolvedValue(PLACE_FIXTURE)
  permissionGroupFindUnique.mockResolvedValue(EMPTY_GROUP)
  permissionGroupDelete.mockResolvedValue(EMPTY_GROUP)
})

describe('deleteGroupAction — happy path', () => {
  it('elimina el grupo y revalida', async () => {
    const result = await deleteGroupAction(VALID_INPUT)

    expect(result).toEqual({ ok: true })
    expect(permissionGroupDelete).toHaveBeenCalledWith({ where: { id: GROUP_ID } })
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/groups`)
  })
})

describe('deleteGroupAction — discriminated union', () => {
  it('preset → cannot_delete_preset (no toca delete)', async () => {
    permissionGroupFindUnique.mockResolvedValue(PRESET_GROUP)

    const result = await deleteGroupAction({ groupId: 'grp-preset' })

    expect(result).toEqual({ ok: false, error: 'cannot_delete_preset' })
    expect(permissionGroupDelete).not.toHaveBeenCalled()
  })

  it('grupo con miembros → group_has_members', async () => {
    permissionGroupFindUnique.mockResolvedValue(POPULATED_GROUP)

    const result = await deleteGroupAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'group_has_members' })
    expect(permissionGroupDelete).not.toHaveBeenCalled()
  })

  it('grupo no existe → NotFoundError', async () => {
    permissionGroupFindUnique.mockResolvedValue(null)
    await expect(deleteGroupAction(VALID_INPUT)).rejects.toThrow(NotFoundError)
  })
})

describe('deleteGroupAction — gates', () => {
  it('actor sin ownership → AuthorizationError', async () => {
    findPlaceOwnershipFn.mockResolvedValue(false)
    await expect(deleteGroupAction(VALID_INPUT)).rejects.toThrow(AuthorizationError)
    expect(permissionGroupDelete).not.toHaveBeenCalled()
  })

  it('place archivado → NotFoundError', async () => {
    loadPlaceByIdFn.mockResolvedValue({ ...PLACE_FIXTURE, archivedAt: new Date() })
    await expect(deleteGroupAction(VALID_INPUT)).rejects.toThrow(NotFoundError)
  })
})

describe('deleteGroupAction — validación Zod', () => {
  it('groupId vacío → ValidationError', async () => {
    await expect(deleteGroupAction({ groupId: '' })).rejects.toThrow(ValidationError)
  })

  it('input null → ValidationError', async () => {
    await expect(deleteGroupAction(null)).rejects.toThrow(ValidationError)
  })
})
