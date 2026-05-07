import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Tests de `unblockMemberAction` (G.4 — PermissionGroups).
 *
 * Cobertura:
 *  - Happy path: desbloquea + email + commitea (con y sin message).
 *  - Discriminated union: not_blocked, target_user_not_member.
 *  - Gates: ValidationError, AuthorizationError (sin permiso),
 *    NotFoundError.
 *  - Try/catch del email: failure no bloquea el commit.
 *  - blockedReason / blockedByUserId / blockedContactEmail SE MANTIENEN
 *    como histórico (no se limpian).
 */

const requireAuthUserIdFn = vi.fn()
const loadPlaceByIdFn = vi.fn()
const hasPermissionFn = vi.fn()
const membershipFindFirst = vi.fn()
const membershipUpdate = vi.fn()
const sendUnblockEmailFn = vi.fn()
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

vi.mock('@/shared/lib/place-loader', () => ({
  loadPlaceById: (...a: unknown[]) => loadPlaceByIdFn(...a),
}))

vi.mock('@/features/members/server/permissions', () => ({
  hasPermission: (...a: unknown[]) => hasPermissionFn(...a),
}))

vi.mock('@/features/members/moderation/server/mailer/unblock-email', () => ({
  sendUnblockEmail: (...a: unknown[]) => sendUnblockEmailFn(...a),
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
}))

vi.mock('server-only', () => ({}))

import { unblockMemberAction } from '@/features/members/moderation/server/actions/unblock-member'

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
  message: 'Bienvenido de vuelta.',
  contactEmail: 'admin@example.com',
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAuthUserIdFn.mockResolvedValue(ACTOR_ID)
  loadPlaceByIdFn.mockResolvedValue(PLACE_FIXTURE)
  hasPermissionFn.mockResolvedValue(true)
  // Por default: target ES miembro activo bloqueado.
  membershipFindFirst.mockResolvedValue({
    id: TARGET_MEMBERSHIP_ID,
    blockedAt: new Date('2026-04-30T00:00:00Z'),
    user: { email: TARGET_EMAIL },
  })
  membershipUpdate.mockResolvedValue({ id: TARGET_MEMBERSHIP_ID })
  sendUnblockEmailFn.mockResolvedValue({ id: 'msg-1', provider: 'fake' })
})

describe('unblockMemberAction — happy path', () => {
  it('desbloquea al miembro y retorna { ok: true }', async () => {
    const result = await unblockMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: true })
    expect(membershipUpdate).toHaveBeenCalledWith({
      where: { id: TARGET_MEMBERSHIP_ID },
      data: { blockedAt: null },
    })
  })

  it('NO limpia blockedReason ni blockedByUserId (histórico)', async () => {
    await unblockMemberAction(VALID_INPUT)

    const call = membershipUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(call.data).not.toHaveProperty('blockedReason')
    expect(call.data).not.toHaveProperty('blockedByUserId')
    expect(call.data).not.toHaveProperty('blockedContactEmail')
  })

  it('envía email con message y contactEmail', async () => {
    await unblockMemberAction(VALID_INPUT)

    expect(sendUnblockEmailFn).toHaveBeenCalledWith({
      to: TARGET_EMAIL,
      placeName: PLACE_NAME,
      message: VALID_INPUT.message,
      contactEmail: VALID_INPUT.contactEmail,
    })
  })

  it('message ausente → envía null en el email', async () => {
    const { message: _omit, ...inputSinMessage } = VALID_INPUT

    await unblockMemberAction(inputSinMessage)

    expect(sendUnblockEmailFn).toHaveBeenCalledWith(expect.objectContaining({ message: null }))
  })

  it('message vacío trim → envía null en el email', async () => {
    await unblockMemberAction({ ...VALID_INPUT, message: '   ' })

    expect(sendUnblockEmailFn).toHaveBeenCalledWith(expect.objectContaining({ message: null }))
  })

  it('revalida la page del detalle del miembro', async () => {
    await unblockMemberAction(VALID_INPUT)

    expect(revalidatePathFn).toHaveBeenCalledWith(
      `/${PLACE_SLUG}/settings/members/${TARGET_USER_ID}`,
    )
  })
})

describe('unblockMemberAction — discriminated union errors', () => {
  it('target no es miembro activo → target_user_not_member', async () => {
    membershipFindFirst.mockResolvedValue(null)

    const result = await unblockMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'target_user_not_member' })
    expect(membershipUpdate).not.toHaveBeenCalled()
    expect(sendUnblockEmailFn).not.toHaveBeenCalled()
  })

  it('target NO está bloqueado → not_blocked', async () => {
    membershipFindFirst.mockResolvedValue({
      id: TARGET_MEMBERSHIP_ID,
      blockedAt: null,
      user: { email: TARGET_EMAIL },
    })

    const result = await unblockMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'not_blocked' })
    expect(membershipUpdate).not.toHaveBeenCalled()
    expect(sendUnblockEmailFn).not.toHaveBeenCalled()
  })
})

describe('unblockMemberAction — gates', () => {
  it('input inválido (contactEmail no es email) → ValidationError', async () => {
    await expect(
      unblockMemberAction({ ...VALID_INPUT, contactEmail: 'not-an-email' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('place inexistente → NotFoundError', async () => {
    loadPlaceByIdFn.mockResolvedValue(null)
    await expect(unblockMemberAction(VALID_INPUT)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('actor sin permiso members:block → AuthorizationError', async () => {
    hasPermissionFn.mockResolvedValue(false)
    await expect(unblockMemberAction(VALID_INPUT)).rejects.toBeInstanceOf(AuthorizationError)
    expect(membershipUpdate).not.toHaveBeenCalled()
  })

  it('hasPermission se chequea con permiso members:block', async () => {
    await unblockMemberAction(VALID_INPUT)
    expect(hasPermissionFn).toHaveBeenCalledWith(ACTOR_ID, PLACE_ID, 'members:block')
  })
})

describe('unblockMemberAction — email failure resilience', () => {
  it('si el mailer tira, la action commitea ok:true igualmente', async () => {
    sendUnblockEmailFn.mockRejectedValueOnce(new Error('resend down'))

    const result = await unblockMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: true })
    expect(membershipUpdate).toHaveBeenCalled()
  })
})
