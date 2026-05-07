import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Tests de `blockMemberAction` (G.4 — PermissionGroups).
 *
 * Patrón canónico: mocks granulares de Prisma + auth + identity-cache +
 * place-loader + hasPermission + mailer + next/cache.
 *
 * Cobertura:
 *  - Happy path: bloquea + envía email + commitea.
 *  - Discriminated union: cannot_block_owner, cannot_block_self,
 *    already_blocked, target_user_not_member.
 *  - Gates: ValidationError (Zod), AuthorizationError (sin permiso),
 *    NotFoundError (place inexistente / archivado).
 *  - Try/catch del email: si el mailer falla, la action commitea ok:true
 *    y loguea warning.
 */

const requireAuthUserIdFn = vi.fn()
const findPlaceOwnershipFn = vi.fn()
const loadPlaceByIdFn = vi.fn()
const hasPermissionFn = vi.fn()
const membershipFindFirst = vi.fn()
const membershipUpdate = vi.fn()
const sendBlockEmailFn = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    membership: {
      findFirst: (...a: unknown[]) => membershipFindFirst(...a),
      update: (...a: unknown[]) => membershipUpdate(...a),
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

vi.mock('@/features/members/server/permissions', () => ({
  hasPermission: (...a: unknown[]) => hasPermissionFn(...a),
}))

vi.mock('@/features/members/moderation/server/mailer/block-email', () => ({
  sendBlockEmail: (...a: unknown[]) => sendBlockEmailFn(...a),
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
}))

vi.mock('server-only', () => ({}))

import { blockMemberAction } from '@/features/members/moderation/server/actions/block-member'

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'palermo'
const PLACE_NAME = 'Palermo'
const ACTOR_ID = 'user-actor'
const TARGET_USER_ID = 'user-target'
const TARGET_EMAIL = 'target@example.com'
const TARGET_MEMBERSHIP_ID = 'mem-target'

const PLACE_FIXTURE = {
  id: PLACE_ID,
  slug: PLACE_SLUG,
  name: PLACE_NAME,
  archivedAt: null,
}

const VALID_INPUT = {
  placeId: PLACE_ID,
  memberUserId: TARGET_USER_ID,
  reason: 'Spam reiterado en discussions.',
  contactEmail: 'admin@example.com',
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAuthUserIdFn.mockResolvedValue(ACTOR_ID)
  loadPlaceByIdFn.mockResolvedValue(PLACE_FIXTURE)
  hasPermissionFn.mockResolvedValue(true)
  // Por default: target NO es owner, ES miembro activo, NO está bloqueado.
  findPlaceOwnershipFn.mockResolvedValue(false)
  membershipFindFirst.mockResolvedValue({
    id: TARGET_MEMBERSHIP_ID,
    blockedAt: null,
    user: { email: TARGET_EMAIL },
  })
  membershipUpdate.mockResolvedValue({ id: TARGET_MEMBERSHIP_ID })
  sendBlockEmailFn.mockResolvedValue({ id: 'msg-1', provider: 'fake' })
})

describe('blockMemberAction — happy path', () => {
  it('bloquea al miembro y retorna { ok: true }', async () => {
    const result = await blockMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: true })
    expect(membershipUpdate).toHaveBeenCalledWith({
      where: { id: TARGET_MEMBERSHIP_ID },
      data: {
        blockedAt: expect.any(Date),
        blockedByUserId: ACTOR_ID,
        blockedReason: VALID_INPUT.reason,
        blockedContactEmail: VALID_INPUT.contactEmail,
      },
    })
  })

  it('envía email con motivo y contactEmail', async () => {
    await blockMemberAction(VALID_INPUT)

    expect(sendBlockEmailFn).toHaveBeenCalledWith({
      to: TARGET_EMAIL,
      placeName: PLACE_NAME,
      reason: VALID_INPUT.reason,
      contactEmail: VALID_INPUT.contactEmail,
    })
  })

  it('revalida la page del detalle del miembro', async () => {
    await blockMemberAction(VALID_INPUT)

    expect(revalidatePathFn).toHaveBeenCalledWith(
      `/${PLACE_SLUG}/settings/members/${TARGET_USER_ID}`,
    )
  })
})

describe('blockMemberAction — discriminated union errors', () => {
  it('actor === target → cannot_block_self (sin tocar DB)', async () => {
    requireAuthUserIdFn.mockResolvedValue(TARGET_USER_ID)

    const result = await blockMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'cannot_block_self' })
    expect(membershipUpdate).not.toHaveBeenCalled()
    expect(sendBlockEmailFn).not.toHaveBeenCalled()
  })

  it('target es owner → cannot_block_owner', async () => {
    findPlaceOwnershipFn.mockResolvedValue(true)

    const result = await blockMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'cannot_block_owner' })
    expect(membershipUpdate).not.toHaveBeenCalled()
    expect(sendBlockEmailFn).not.toHaveBeenCalled()
  })

  it('target no es miembro activo → target_user_not_member', async () => {
    membershipFindFirst.mockResolvedValue(null)

    const result = await blockMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'target_user_not_member' })
    expect(membershipUpdate).not.toHaveBeenCalled()
    expect(sendBlockEmailFn).not.toHaveBeenCalled()
  })

  it('target ya bloqueado → already_blocked', async () => {
    membershipFindFirst.mockResolvedValue({
      id: TARGET_MEMBERSHIP_ID,
      blockedAt: new Date('2026-04-30T00:00:00Z'),
      user: { email: TARGET_EMAIL },
    })

    const result = await blockMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'already_blocked' })
    expect(membershipUpdate).not.toHaveBeenCalled()
    expect(sendBlockEmailFn).not.toHaveBeenCalled()
  })
})

describe('blockMemberAction — gates', () => {
  it('input inválido (reason vacío) → ValidationError', async () => {
    await expect(blockMemberAction({ ...VALID_INPUT, reason: '' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(membershipUpdate).not.toHaveBeenCalled()
  })

  it('input inválido (contactEmail no es email) → ValidationError', async () => {
    await expect(
      blockMemberAction({ ...VALID_INPUT, contactEmail: 'not-an-email' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('reason demasiado largo → ValidationError', async () => {
    await expect(
      blockMemberAction({ ...VALID_INPUT, reason: 'x'.repeat(501) }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('place inexistente → NotFoundError', async () => {
    loadPlaceByIdFn.mockResolvedValue(null)
    await expect(blockMemberAction(VALID_INPUT)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('place archivado → NotFoundError', async () => {
    loadPlaceByIdFn.mockResolvedValue({ ...PLACE_FIXTURE, archivedAt: new Date() })
    await expect(blockMemberAction(VALID_INPUT)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('actor sin permiso members:block → AuthorizationError', async () => {
    hasPermissionFn.mockResolvedValue(false)
    await expect(blockMemberAction(VALID_INPUT)).rejects.toBeInstanceOf(AuthorizationError)
    expect(membershipUpdate).not.toHaveBeenCalled()
  })

  it('hasPermission se chequea con permiso members:block', async () => {
    await blockMemberAction(VALID_INPUT)
    expect(hasPermissionFn).toHaveBeenCalledWith(ACTOR_ID, PLACE_ID, 'members:block')
  })
})

describe('blockMemberAction — email failure resilience', () => {
  it('si el mailer tira, la action commitea ok:true igualmente', async () => {
    sendBlockEmailFn.mockRejectedValueOnce(new Error('resend down'))

    const result = await blockMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: true })
    expect(membershipUpdate).toHaveBeenCalled()
  })

  it('falla del mailer NO impide la revalidación de la page', async () => {
    sendBlockEmailFn.mockRejectedValueOnce(new Error('resend down'))

    await blockMemberAction(VALID_INPUT)

    expect(revalidatePathFn).toHaveBeenCalledWith(
      `/${PLACE_SLUG}/settings/members/${TARGET_USER_ID}`,
    )
  })
})
