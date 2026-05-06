import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

const requireAuthUserIdFn = vi.fn()
const findPlaceOwnershipFn = vi.fn()
const findActiveMembershipFn = vi.fn()
const loadPlaceByIdFn = vi.fn()
const permissionGroupFindUnique = vi.fn()
const groupMembershipCreate = vi.fn()
const groupMembershipDelete = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    permissionGroup: {
      findUnique: (...a: unknown[]) => permissionGroupFindUnique(...a),
    },
    groupMembership: {
      create: (...a: unknown[]) => groupMembershipCreate(...a),
      delete: (...a: unknown[]) => groupMembershipDelete(...a),
    },
  },
}))

vi.mock('@/shared/lib/auth-user', () => ({
  requireAuthUserId: (...a: unknown[]) => requireAuthUserIdFn(...a),
}))

vi.mock('@/shared/lib/identity-cache', () => ({
  findPlaceOwnership: (...a: unknown[]) => findPlaceOwnershipFn(...a),
  findActiveMembership: (...a: unknown[]) => findActiveMembershipFn(...a),
}))

vi.mock('@/shared/lib/place-loader', () => ({
  loadPlaceById: (...a: unknown[]) => loadPlaceByIdFn(...a),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
  // Plan #2.3: add/removeMemberFromGroup invalidan findMemberPermissions
  // del target via revalidateTag.
  unstable_cache: <T extends (...args: never[]) => Promise<unknown>>(fn: T): T => fn,
  revalidateTag: vi.fn(),
}))

vi.mock('server-only', () => ({}))

// Plan #2.3: importar `revalidateMemberPermissions` desde `members/public.server.ts`
// trae transitivamente la cadena de re-exports del barrel (incluye UI components
// que importan actions legacy con `clientEnv` eager). Mockear env evita que el
// schema Zod parsee variables ausentes en el entorno de tests.
vi.mock('@/shared/config/env', () => ({
  clientEnv: {
    NEXT_PUBLIC_APP_URL: 'http://lvh.me:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000',
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  },
  serverEnv: {
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    NODE_ENV: 'test',
  },
}))

import { addMemberToGroupAction } from '@/features/groups/memberships/server/actions/add-member-to-group'
import { removeMemberFromGroupAction } from '@/features/groups/memberships/server/actions/remove-member-from-group'

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'palermo'
const ACTOR_ID = 'user-owner'
const TARGET_USER_ID = 'user-target'
const GROUP_ID = 'grp-1'

const PLACE_FIXTURE = {
  id: PLACE_ID,
  slug: PLACE_SLUG,
  name: 'Palermo',
  archivedAt: null,
}

const GROUP_ROW = { id: GROUP_ID, placeId: PLACE_ID }

const ADD_INPUT = { groupId: GROUP_ID, userId: TARGET_USER_ID }
const REMOVE_INPUT = { groupId: GROUP_ID, userId: TARGET_USER_ID }

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('unique violation', {
    code: 'P2002',
    clientVersion: 'test',
  })
}

function p2025(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('record not found', {
    code: 'P2025',
    clientVersion: 'test',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAuthUserIdFn.mockResolvedValue(ACTOR_ID)
  loadPlaceByIdFn.mockResolvedValue(PLACE_FIXTURE)
  permissionGroupFindUnique.mockResolvedValue(GROUP_ROW)
  // Default: actor es owner; target NO es owner; target es miembro activo.
  findPlaceOwnershipFn.mockImplementation((userId: string) => Promise.resolve(userId === ACTOR_ID))
  findActiveMembershipFn.mockResolvedValue({ id: 'membership-target', role: 'MEMBER' })
  groupMembershipCreate.mockResolvedValue({ id: 'gm-1' })
  groupMembershipDelete.mockResolvedValue({})
})

describe('addMemberToGroupAction — happy path', () => {
  it('inserta el row con addedByUserId del actor', async () => {
    const result = await addMemberToGroupAction(ADD_INPUT)

    expect(result).toEqual({ ok: true })
    expect(groupMembershipCreate).toHaveBeenCalledTimes(1)
    const call = groupMembershipCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>
    }
    expect(call.data).toMatchObject({
      groupId: GROUP_ID,
      userId: TARGET_USER_ID,
      placeId: PLACE_ID,
      addedByUserId: ACTOR_ID,
    })
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/groups`)
    expect(revalidatePathFn).toHaveBeenCalledWith(
      `/${PLACE_SLUG}/settings/members/${TARGET_USER_ID}`,
    )
  })
})

describe('addMemberToGroupAction — discriminated union', () => {
  it('target es owner del place → target_is_owner', async () => {
    findPlaceOwnershipFn.mockImplementation(() => Promise.resolve(true))

    const result = await addMemberToGroupAction(ADD_INPUT)

    expect(result).toEqual({ ok: false, error: 'target_is_owner' })
    expect(groupMembershipCreate).not.toHaveBeenCalled()
  })

  it('target sin membership activa → target_user_not_member', async () => {
    findActiveMembershipFn.mockResolvedValue(null)

    const result = await addMemberToGroupAction(ADD_INPUT)

    expect(result).toEqual({ ok: false, error: 'target_user_not_member' })
    expect(groupMembershipCreate).not.toHaveBeenCalled()
  })

  it('P2002 (race con asignación concurrente) → already_in_group', async () => {
    groupMembershipCreate.mockRejectedValue(p2002())

    const result = await addMemberToGroupAction(ADD_INPUT)

    expect(result).toEqual({ ok: false, error: 'already_in_group' })
  })

  it('error no Prisma → re-throw', async () => {
    groupMembershipCreate.mockRejectedValue(new Error('boom'))
    await expect(addMemberToGroupAction(ADD_INPUT)).rejects.toThrow('boom')
  })
})

describe('addMemberToGroupAction — gates', () => {
  it('grupo no existe → NotFoundError', async () => {
    permissionGroupFindUnique.mockResolvedValue(null)
    await expect(addMemberToGroupAction(ADD_INPUT)).rejects.toThrow(NotFoundError)
  })

  it('actor sin ownership → AuthorizationError', async () => {
    findPlaceOwnershipFn.mockImplementation(() => Promise.resolve(false))
    await expect(addMemberToGroupAction(ADD_INPUT)).rejects.toThrow(AuthorizationError)
  })

  it('place archivado → NotFoundError', async () => {
    loadPlaceByIdFn.mockResolvedValue({ ...PLACE_FIXTURE, archivedAt: new Date() })
    await expect(addMemberToGroupAction(ADD_INPUT)).rejects.toThrow(NotFoundError)
  })
})

describe('addMemberToGroupAction — validación Zod', () => {
  it('userId vacío → ValidationError', async () => {
    await expect(addMemberToGroupAction({ ...ADD_INPUT, userId: '' })).rejects.toThrow(
      ValidationError,
    )
  })

  it('groupId vacío → ValidationError', async () => {
    await expect(addMemberToGroupAction({ ...ADD_INPUT, groupId: '' })).rejects.toThrow(
      ValidationError,
    )
  })
})

describe('removeMemberFromGroupAction — happy path', () => {
  it('borra por par compuesto (groupId, userId)', async () => {
    const result = await removeMemberFromGroupAction(REMOVE_INPUT)

    expect(result).toEqual({ ok: true })
    expect(groupMembershipDelete).toHaveBeenCalledWith({
      where: { groupId_userId: { groupId: GROUP_ID, userId: TARGET_USER_ID } },
    })
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/groups`)
  })
})

describe('removeMemberFromGroupAction — discriminated union', () => {
  it('P2025 (no estaba) → not_in_group', async () => {
    groupMembershipDelete.mockRejectedValue(p2025())

    const result = await removeMemberFromGroupAction(REMOVE_INPUT)

    expect(result).toEqual({ ok: false, error: 'not_in_group' })
  })

  it('error no Prisma → re-throw', async () => {
    groupMembershipDelete.mockRejectedValue(new Error('boom'))
    await expect(removeMemberFromGroupAction(REMOVE_INPUT)).rejects.toThrow('boom')
  })
})

describe('removeMemberFromGroupAction — gates', () => {
  it('actor sin ownership → AuthorizationError', async () => {
    findPlaceOwnershipFn.mockImplementation(() => Promise.resolve(false))
    await expect(removeMemberFromGroupAction(REMOVE_INPUT)).rejects.toThrow(AuthorizationError)
  })

  it('grupo no existe → NotFoundError', async () => {
    permissionGroupFindUnique.mockResolvedValue(null)
    await expect(removeMemberFromGroupAction(REMOVE_INPUT)).rejects.toThrow(NotFoundError)
  })
})

describe('removeMemberFromGroupAction — validación Zod', () => {
  it('input vacío → ValidationError', async () => {
    await expect(removeMemberFromGroupAction({})).rejects.toThrow(ValidationError)
  })
})
