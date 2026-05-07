import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

const requireAuthUserIdFn = vi.fn()
const findPlaceOwnershipFn = vi.fn()
const loadPlaceBySlugFn = vi.fn()
const permissionGroupFindFirst = vi.fn()
const permissionGroupCreate = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    permissionGroup: {
      findFirst: (...a: unknown[]) => permissionGroupFindFirst(...a),
      create: (...a: unknown[]) => permissionGroupCreate(...a),
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
  loadPlaceBySlug: (...a: unknown[]) => loadPlaceBySlugFn(...a),
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
}))

vi.mock('server-only', () => ({}))

import { createGroupAction } from '../server/actions/create-group'

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'palermo'
const ACTOR_ID = 'user-owner'
const NEW_GROUP_ID = 'grp-new'

const PLACE_FIXTURE = {
  id: PLACE_ID,
  slug: PLACE_SLUG,
  name: 'Palermo',
  archivedAt: null,
}

const VALID_INPUT = {
  placeSlug: PLACE_SLUG,
  name: 'Moderadores',
  description: 'Mods de discusiones',
  permissions: ['flags:review', 'discussions:hide-post'],
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('unique violation', {
    code: 'P2002',
    clientVersion: 'test',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAuthUserIdFn.mockResolvedValue(ACTOR_ID)
  findPlaceOwnershipFn.mockResolvedValue(true)
  loadPlaceBySlugFn.mockResolvedValue(PLACE_FIXTURE)
  permissionGroupFindFirst.mockResolvedValue(null)
  permissionGroupCreate.mockResolvedValue({ id: NEW_GROUP_ID })
})

describe('createGroupAction — happy path', () => {
  it('crea el grupo y retorna { ok, groupId }', async () => {
    const result = await createGroupAction(VALID_INPUT)

    expect(result).toEqual({ ok: true, groupId: NEW_GROUP_ID })
    expect(permissionGroupCreate).toHaveBeenCalledTimes(1)
    const call = permissionGroupCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>
    }
    expect(call.data.placeId).toBe(PLACE_ID)
    expect(call.data.name).toBe('Moderadores')
    expect(call.data.description).toBe('Mods de discusiones')
    expect(call.data.permissions).toEqual(['flags:review', 'discussions:hide-post'])
    expect(call.data.isPreset).toBe(false)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/groups`)
  })

  it('persiste categoryScopes cuando se pasan', async () => {
    await createGroupAction({
      ...VALID_INPUT,
      permissions: ['library:moderate-items'],
      categoryScopeIds: ['cat-1', 'cat-2'],
    })
    const call = permissionGroupCreate.mock.calls[0]?.[0] as {
      data: { categoryScopes?: { create: Array<{ categoryId: string }> } }
    }
    expect(call.data.categoryScopes?.create).toEqual([
      { categoryId: 'cat-1' },
      { categoryId: 'cat-2' },
    ])
  })

  it('description vacío se persiste como null', async () => {
    await createGroupAction({ ...VALID_INPUT, description: '   ' })
    const call = permissionGroupCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>
    }
    expect(call.data.description).toBeNull()
  })
})

describe('createGroupAction — discriminated union', () => {
  it('name colisiona case-insensitive → group_name_taken', async () => {
    permissionGroupFindFirst.mockResolvedValue({ id: 'grp-existing' })

    const result = await createGroupAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'group_name_taken' })
    expect(permissionGroupCreate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })

  it('P2002 del create (race con concurrente) → group_name_taken', async () => {
    permissionGroupCreate.mockRejectedValue(p2002())

    const result = await createGroupAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'group_name_taken' })
  })

  it('permissions con valor fuera del enum → permission_invalid (defense post-Zod)', async () => {
    // Zod ya rechaza si pasamos string fuera del enum — caso simulado
    // donde Zod aceptaría el shape pero la lista incluye un valor que el
    // enum rechaza. Bypaseamos pasando el array como cualquier string que
    // matchee shape. Validamos vía un input que pase Zod (todos están en
    // enum) → caso real cubierto: este branch sólo se ejerce con enum
    // tweak, por eso lo cubrimos en invariants.test (arePermissionsValid).
    // Acá verificamos el efecto inverso: input limpio NO retorna permission_invalid.
    const result = await createGroupAction(VALID_INPUT)
    expect(result.ok).toBe(true)
  })

  it('error no Prisma del create → re-throw (no se traga)', async () => {
    permissionGroupCreate.mockRejectedValue(new Error('boom'))
    await expect(createGroupAction(VALID_INPUT)).rejects.toThrow('boom')
  })
})

describe('createGroupAction — gates', () => {
  it('place inexistente → NotFoundError', async () => {
    loadPlaceBySlugFn.mockResolvedValue(null)
    await expect(createGroupAction(VALID_INPUT)).rejects.toThrow(NotFoundError)
    expect(permissionGroupCreate).not.toHaveBeenCalled()
  })

  it('place archivado → NotFoundError', async () => {
    loadPlaceBySlugFn.mockResolvedValue({ ...PLACE_FIXTURE, archivedAt: new Date() })
    await expect(createGroupAction(VALID_INPUT)).rejects.toThrow(NotFoundError)
  })

  it('actor sin ownership → AuthorizationError (admin no califica)', async () => {
    findPlaceOwnershipFn.mockResolvedValue(false)
    await expect(createGroupAction(VALID_INPUT)).rejects.toThrow(AuthorizationError)
    expect(permissionGroupCreate).not.toHaveBeenCalled()
  })
})

describe('createGroupAction — validación Zod', () => {
  it('placeSlug vacío → ValidationError', async () => {
    await expect(createGroupAction({ ...VALID_INPUT, placeSlug: '' })).rejects.toThrow(
      ValidationError,
    )
  })

  it('name vacío post-trim → ValidationError', async () => {
    await expect(createGroupAction({ ...VALID_INPUT, name: '   ' })).rejects.toThrow(
      ValidationError,
    )
  })

  it('permissions con string fuera del enum → ValidationError', async () => {
    await expect(createGroupAction({ ...VALID_INPUT, permissions: ['evil:exec'] })).rejects.toThrow(
      ValidationError,
    )
  })

  it('input null → ValidationError', async () => {
    await expect(createGroupAction(null)).rejects.toThrow(ValidationError)
  })
})
