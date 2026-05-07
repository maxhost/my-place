import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Tests de `removeTierAssignmentAction` (M.2).
 *
 * Cubre:
 *  - Happy path: borra el row + revalida la page del miembro.
 *  - Discriminated union: assignment_not_found.
 *  - Gates: auth, place archivado, no owner.
 *  - Validación Zod (input mal formado).
 */

const requireAuthUserIdFn = vi.fn()
const findPlaceOwnershipFn = vi.fn()
const loadPlaceByIdFn = vi.fn()
const tierMembershipFindUnique = vi.fn()
const tierMembershipDelete = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    tierMembership: {
      findUnique: (...a: unknown[]) => tierMembershipFindUnique(...a),
      delete: (...a: unknown[]) => tierMembershipDelete(...a),
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

import { removeTierAssignmentAction } from '../server/actions/remove-tier-assignment'

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'palermo'
const ACTOR_ID = 'user-owner'
const TARGET_USER_ID = 'user-target'
const TIER_ID = 'tier-1'
const TM_ID = 'tm-1'

const PLACE_FIXTURE = {
  id: PLACE_ID,
  slug: PLACE_SLUG,
  name: 'Palermo',
  archivedAt: null,
}

const TM_ROW = {
  id: TM_ID,
  placeId: PLACE_ID,
  userId: TARGET_USER_ID,
  tierId: TIER_ID,
}

const VALID_INPUT = { tierMembershipId: TM_ID }

beforeEach(() => {
  vi.clearAllMocks()
  requireAuthUserIdFn.mockResolvedValue(ACTOR_ID)
  findPlaceOwnershipFn.mockResolvedValue(true)
  loadPlaceByIdFn.mockResolvedValue(PLACE_FIXTURE)
  tierMembershipFindUnique.mockResolvedValue(TM_ROW)
  tierMembershipDelete.mockResolvedValue(TM_ROW)
})

describe('removeTierAssignmentAction — happy path', () => {
  it('borra el row por id explícito (no por par tierId/userId)', async () => {
    const result = await removeTierAssignmentAction(VALID_INPUT)

    expect(result).toEqual({ ok: true })
    expect(tierMembershipDelete).toHaveBeenCalledTimes(1)
    expect(tierMembershipDelete).toHaveBeenCalledWith({ where: { id: TM_ID } })
    expect(revalidatePathFn).toHaveBeenCalledWith(
      `/${PLACE_SLUG}/settings/members/${TARGET_USER_ID}`,
    )
  })
})

describe('removeTierAssignmentAction — discriminated union', () => {
  it('row no existe → return assignment_not_found (sin throw)', async () => {
    tierMembershipFindUnique.mockResolvedValue(null)

    const result = await removeTierAssignmentAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'assignment_not_found' })
    expect(tierMembershipDelete).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })
})

describe('removeTierAssignmentAction — gates', () => {
  it('place archivado → NotFoundError (no debería pasar pero se gateó)', async () => {
    loadPlaceByIdFn.mockResolvedValue({ ...PLACE_FIXTURE, archivedAt: new Date() })
    await expect(removeTierAssignmentAction(VALID_INPUT)).rejects.toThrow(NotFoundError)
    expect(tierMembershipDelete).not.toHaveBeenCalled()
  })

  it('place null (race con cascade delete) → NotFoundError', async () => {
    loadPlaceByIdFn.mockResolvedValue(null)
    await expect(removeTierAssignmentAction(VALID_INPUT)).rejects.toThrow(NotFoundError)
  })

  it('actor sin ownership → AuthorizationError', async () => {
    findPlaceOwnershipFn.mockResolvedValue(false)
    await expect(removeTierAssignmentAction(VALID_INPUT)).rejects.toThrow(AuthorizationError)
    expect(tierMembershipDelete).not.toHaveBeenCalled()
  })

  it('sin sesión → AuthorizationError vía requireAuthUserId', async () => {
    requireAuthUserIdFn.mockRejectedValue(new AuthorizationError('Necesitás iniciar sesión.'))
    await expect(removeTierAssignmentAction(VALID_INPUT)).rejects.toThrow(AuthorizationError)
    expect(tierMembershipFindUnique).not.toHaveBeenCalled()
  })
})

describe('removeTierAssignmentAction — validación Zod', () => {
  it('tierMembershipId vacío → ValidationError', async () => {
    await expect(removeTierAssignmentAction({ tierMembershipId: '' })).rejects.toThrow(
      ValidationError,
    )
  })

  it('input null → ValidationError', async () => {
    await expect(removeTierAssignmentAction(null)).rejects.toThrow(ValidationError)
  })

  it('input sin tierMembershipId → ValidationError', async () => {
    await expect(removeTierAssignmentAction({})).rejects.toThrow(ValidationError)
  })
})
