import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Tests de `assignTierToMemberAction` (M.2).
 *
 * Cubre:
 *  - Happy path (asignación con expiración + indefinida).
 *  - Discriminated union: tier_not_published, target_user_not_member,
 *    tier_already_assigned (catch P2002).
 *  - Gates: auth, place no encontrado, place archivado, no owner.
 *  - Snapshot: incluye displayName + avatarUrl del actor.
 *  - Validación Zod (input mal formado).
 */

const requireAuthUserIdFn = vi.fn()
const findPlaceOwnershipFn = vi.fn()
const findActiveMembershipFn = vi.fn()
const findUserProfileFn = vi.fn()
const loadPlaceBySlugFn = vi.fn()
const tierFindUnique = vi.fn()
const tierMembershipCreate = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    tier: {
      findUnique: (...a: unknown[]) => tierFindUnique(...a),
    },
    tierMembership: {
      create: (...a: unknown[]) => tierMembershipCreate(...a),
    },
  },
}))

vi.mock('@/shared/lib/auth-user', () => ({
  requireAuthUserId: (...a: unknown[]) => requireAuthUserIdFn(...a),
}))

vi.mock('@/shared/lib/identity-cache', () => ({
  findPlaceOwnership: (...a: unknown[]) => findPlaceOwnershipFn(...a),
  findActiveMembership: (...a: unknown[]) => findActiveMembershipFn(...a),
  findUserProfile: (...a: unknown[]) => findUserProfileFn(...a),
}))

vi.mock('@/shared/lib/place-loader', () => ({
  loadPlaceBySlug: (...a: unknown[]) => loadPlaceBySlugFn(...a),
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
  revalidateTag: vi.fn(),
}))

vi.mock('server-only', () => ({}))

import { assignTierToMemberAction } from '../server/actions/assign-tier'

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

const VALID_INPUT = {
  placeSlug: PLACE_SLUG,
  memberUserId: TARGET_USER_ID,
  tierId: TIER_ID,
  indefinite: false,
}

const PUBLISHED_TIER = {
  id: TIER_ID,
  placeId: PLACE_ID,
  duration: 'ONE_MONTH' as const,
  visibility: 'PUBLISHED' as const,
}

const ACTIVE_MEMBERSHIP = { id: 'membership-1', role: 'MEMBER' as const }

const ASSIGNER_PROFILE = { displayName: 'Maxi', avatarUrl: null as string | null }

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`tierId`, `userId`)',
    { code: 'P2002', clientVersion: 'test' },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAuthUserIdFn.mockResolvedValue(ACTOR_ID)
  findPlaceOwnershipFn.mockResolvedValue(true)
  loadPlaceBySlugFn.mockResolvedValue(PLACE_FIXTURE)
  tierFindUnique.mockResolvedValue(PUBLISHED_TIER)
  findActiveMembershipFn.mockResolvedValue(ACTIVE_MEMBERSHIP)
  findUserProfileFn.mockResolvedValue(ASSIGNER_PROFILE)
  tierMembershipCreate.mockResolvedValue({ id: TM_ID })
})

describe('assignTierToMemberAction — happy path', () => {
  it('asigna tier con expiración calculada (indefinite=false) y retorna { ok, tierMembershipId }', async () => {
    const result = await assignTierToMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: true, tierMembershipId: TM_ID })
    expect(tierMembershipCreate).toHaveBeenCalledTimes(1)
    const call = tierMembershipCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(call.data.tierId).toBe(TIER_ID)
    expect(call.data.userId).toBe(TARGET_USER_ID)
    expect(call.data.placeId).toBe(PLACE_ID)
    expect(call.data.assignedByUserId).toBe(ACTOR_ID)
    expect(call.data.expiresAt).toBeInstanceOf(Date)
    expect(call.data.indefinite).toBeUndefined() // input flag, no se persiste
    expect(revalidatePathFn).toHaveBeenCalledWith(
      `/${PLACE_SLUG}/settings/members/${TARGET_USER_ID}`,
    )
  })

  it('asigna tier indefinido (indefinite=true) → expiresAt = null', async () => {
    const result = await assignTierToMemberAction({ ...VALID_INPUT, indefinite: true })

    expect(result.ok).toBe(true)
    const call = tierMembershipCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(call.data.expiresAt).toBeNull()
  })

  it('persiste snapshot { displayName, avatarUrl } del actor', async () => {
    findUserProfileFn.mockResolvedValue({
      displayName: 'Owner Maxi',
      avatarUrl: 'https://example.test/a.png',
    })

    await assignTierToMemberAction(VALID_INPUT)

    const call = tierMembershipCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(call.data.assignedBySnapshot).toEqual({
      displayName: 'Owner Maxi',
      avatarUrl: 'https://example.test/a.png',
    })
  })

  it('default indefinite=false (Zod default) si no se pasa', async () => {
    const result = await assignTierToMemberAction({
      placeSlug: PLACE_SLUG,
      memberUserId: TARGET_USER_ID,
      tierId: TIER_ID,
    })

    expect(result.ok).toBe(true)
    const call = tierMembershipCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(call.data.expiresAt).toBeInstanceOf(Date) // default false → calcula expiración
  })
})

describe('assignTierToMemberAction — discriminated union', () => {
  it('tier no PUBLISHED → return tier_not_published', async () => {
    tierFindUnique.mockResolvedValue({ ...PUBLISHED_TIER, visibility: 'HIDDEN' as const })

    const result = await assignTierToMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'tier_not_published' })
    expect(tierMembershipCreate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })

  it('target no es miembro activo → return target_user_not_member', async () => {
    findActiveMembershipFn.mockResolvedValue(null)

    const result = await assignTierToMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'target_user_not_member' })
    expect(tierMembershipCreate).not.toHaveBeenCalled()
  })

  it('P2002 (race con asignación concurrente) → return tier_already_assigned', async () => {
    tierMembershipCreate.mockRejectedValue(p2002())

    const result = await assignTierToMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'tier_already_assigned' })
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })

  it('error no Prisma del create → re-throw (no se traga)', async () => {
    tierMembershipCreate.mockRejectedValue(new Error('boom'))

    await expect(assignTierToMemberAction(VALID_INPUT)).rejects.toThrow('boom')
  })
})

describe('assignTierToMemberAction — gates', () => {
  it('place inexistente → NotFoundError', async () => {
    loadPlaceBySlugFn.mockResolvedValue(null)
    await expect(assignTierToMemberAction(VALID_INPUT)).rejects.toThrow(NotFoundError)
    expect(tierMembershipCreate).not.toHaveBeenCalled()
  })

  it('place archivado → NotFoundError', async () => {
    loadPlaceBySlugFn.mockResolvedValue({ ...PLACE_FIXTURE, archivedAt: new Date() })
    await expect(assignTierToMemberAction(VALID_INPUT)).rejects.toThrow(NotFoundError)
  })

  it('actor sin ownership → AuthorizationError (admin no califica)', async () => {
    findPlaceOwnershipFn.mockResolvedValue(false)
    await expect(assignTierToMemberAction(VALID_INPUT)).rejects.toThrow(AuthorizationError)
    expect(tierMembershipCreate).not.toHaveBeenCalled()
  })

  it('tier no encontrado → NotFoundError', async () => {
    tierFindUnique.mockResolvedValue(null)
    await expect(assignTierToMemberAction(VALID_INPUT)).rejects.toThrow(NotFoundError)
  })

  it('tier de OTRO place → NotFoundError (defense in depth)', async () => {
    tierFindUnique.mockResolvedValue({ ...PUBLISHED_TIER, placeId: 'place-other' })
    await expect(assignTierToMemberAction(VALID_INPUT)).rejects.toThrow(NotFoundError)
  })

  it('actor sin User profile (race con erasure) → NotFoundError', async () => {
    findUserProfileFn.mockResolvedValue(null)
    await expect(assignTierToMemberAction(VALID_INPUT)).rejects.toThrow(NotFoundError)
  })
})

describe('assignTierToMemberAction — validación Zod', () => {
  it('placeSlug vacío → ValidationError', async () => {
    await expect(assignTierToMemberAction({ ...VALID_INPUT, placeSlug: '' })).rejects.toThrow(
      ValidationError,
    )
  })

  it('memberUserId vacío → ValidationError', async () => {
    await expect(assignTierToMemberAction({ ...VALID_INPUT, memberUserId: '' })).rejects.toThrow(
      ValidationError,
    )
  })

  it('tierId vacío → ValidationError', async () => {
    await expect(assignTierToMemberAction({ ...VALID_INPUT, tierId: '' })).rejects.toThrow(
      ValidationError,
    )
  })

  it('input null → ValidationError', async () => {
    await expect(assignTierToMemberAction(null)).rejects.toThrow(ValidationError)
  })

  it('indefinite no boolean → ValidationError', async () => {
    await expect(
      assignTierToMemberAction({ ...VALID_INPUT, indefinite: 'yes' as unknown as boolean }),
    ).rejects.toThrow(ValidationError)
  })
})
