import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  AuthorizationError,
  ConflictError,
  InvariantViolation,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'

const invitationFindUnique = vi.fn()
const invitationUpdateMany = vi.fn()
const membershipFindFirstTop = vi.fn() // findActiveMembership (outside tx)
const membershipFindFirstTx = vi.fn() // inside tx
const membershipCountTx = vi.fn() // inside tx
const membershipCreateTx = vi.fn() // inside tx
const permissionGroupFindFirstTx = vi.fn() // inside tx (preset lookup)
const groupMembershipCreateTx = vi.fn() // inside tx (admin onboarding)
const transactionFn = vi.fn()
const getUserFn = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    invitation: {
      findUnique: (...a: unknown[]) => invitationFindUnique(...a),
    },
    membership: {
      findFirst: (...a: unknown[]) => membershipFindFirstTop(...a),
    },
    $transaction: (fn: (tx: unknown) => unknown) => transactionFn(fn),
  },
}))

vi.mock('@/shared/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: getUserFn } }),
}))

vi.mock('@/shared/lib/supabase/admin', () => ({
  createSupabaseAdmin: () => ({ auth: { admin: { inviteUserByEmail: vi.fn() } } }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
  // Plan #2.3: el action invalida findMemberPermissions via revalidateTag.
  unstable_cache: <T extends (...args: never[]) => Promise<unknown>>(fn: T): T => fn,
  revalidateTag: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/shared/config/env', () => ({
  clientEnv: {
    NEXT_PUBLIC_APP_URL: 'http://lvh.me:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000',
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  },
  serverEnv: { SUPABASE_SERVICE_ROLE_KEY: 'service' },
}))

import { acceptInvitationAction } from '../server/actions'

const TOKEN = 'x'.repeat(43)
const AUTH_OK = { data: { user: { id: 'user-1' } } }
const AUTH_NONE = { data: { user: null } }

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000)
const PAST = new Date(Date.now() - 1000)

function makeInvitation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'inv-1',
    placeId: 'place-1',
    email: 'ana@example.com',
    invitedBy: 'admin-1',
    asAdmin: false,
    acceptedAt: null,
    expiresAt: FUTURE,
    token: TOKEN,
    place: { id: 'place-1', slug: 'the-company', name: 'The Company', archivedAt: null },
    ...overrides,
  }
}

beforeEach(() => {
  invitationFindUnique.mockReset()
  invitationUpdateMany.mockReset()
  membershipFindFirstTop.mockReset()
  membershipFindFirstTx.mockReset()
  membershipCountTx.mockReset()
  membershipCreateTx.mockReset()
  permissionGroupFindFirstTx.mockReset()
  groupMembershipCreateTx.mockReset()
  transactionFn.mockReset()
  getUserFn.mockReset()
  revalidatePathFn.mockReset()

  transactionFn.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({
      membership: {
        findFirst: membershipFindFirstTx,
        count: membershipCountTx,
        create: membershipCreateTx,
      },
      invitation: {
        updateMany: invitationUpdateMany,
      },
      permissionGroup: {
        findFirst: permissionGroupFindFirstTx,
      },
      groupMembership: {
        create: groupMembershipCreateTx,
      },
    }),
  )
})

describe('acceptInvitationAction', () => {
  it('rechaza token no-string con ValidationError', async () => {
    await expect(acceptInvitationAction(undefined)).rejects.toBeInstanceOf(ValidationError)
    await expect(acceptInvitationAction('')).rejects.toBeInstanceOf(ValidationError)
  })

  it('rechaza sin sesión con AuthorizationError', async () => {
    getUserFn.mockResolvedValue(AUTH_NONE)
    await expect(acceptInvitationAction(TOKEN)).rejects.toBeInstanceOf(AuthorizationError)
    expect(invitationFindUnique).not.toHaveBeenCalled()
  })

  it('token inexistente → NotFoundError', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(null)
    await expect(acceptInvitationAction(TOKEN)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('token expirado → ValidationError con reason=expired', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(makeInvitation({ expiresAt: PAST }))
    await expect(acceptInvitationAction(TOKEN)).rejects.toMatchObject({
      code: 'VALIDATION',
      context: expect.objectContaining({ reason: 'expired' }),
    })
    expect(transactionFn).not.toHaveBeenCalled()
  })

  it('place archivado → ConflictError', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(
      makeInvitation({
        place: {
          id: 'place-1',
          slug: 'the-company',
          name: 'The Company',
          archivedAt: new Date(),
        },
      }),
    )
    await expect(acceptInvitationAction(TOKEN)).rejects.toBeInstanceOf(ConflictError)
  })

  it('ya aceptada y yo ya soy miembro → idempotente alreadyMember=true', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(makeInvitation({ acceptedAt: new Date() }))
    membershipFindFirstTop.mockResolvedValue({ id: 'mem-1' })

    const res = await acceptInvitationAction(TOKEN)
    expect(res).toEqual({ ok: true, placeSlug: 'the-company', alreadyMember: true })
    expect(transactionFn).not.toHaveBeenCalled()
  })

  it('ya aceptada por otro (no soy miembro) → ConflictError already_used', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(makeInvitation({ acceptedAt: new Date() }))
    membershipFindFirstTop.mockResolvedValue(null)

    await expect(acceptInvitationAction(TOKEN)).rejects.toMatchObject({
      code: 'CONFLICT',
      context: expect.objectContaining({ reason: 'already_used' }),
    })
  })

  it('place en cap (150) dentro de tx → InvariantViolation', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(makeInvitation())
    membershipFindFirstTx.mockResolvedValue(null)
    membershipCountTx.mockResolvedValue(150)

    await expect(acceptInvitationAction(TOKEN)).rejects.toBeInstanceOf(InvariantViolation)
    expect(membershipCreateTx).not.toHaveBeenCalled()
  })

  it('happy path miembro simple: crea membership y marca acceptedAt (sin onboarding admin)', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(makeInvitation())
    membershipFindFirstTx.mockResolvedValue(null)
    membershipCountTx.mockResolvedValue(50)
    membershipCreateTx.mockResolvedValue({})
    invitationUpdateMany.mockResolvedValue({ count: 1 })

    const res = await acceptInvitationAction(TOKEN)
    expect(res).toEqual({ ok: true, placeSlug: 'the-company', alreadyMember: false })

    expect(membershipCreateTx).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        placeId: 'place-1',
      },
    })
    expect(permissionGroupFindFirstTx).not.toHaveBeenCalled()
    expect(groupMembershipCreateTx).not.toHaveBeenCalled()
    expect(invitationUpdateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', acceptedAt: null },
      data: { acceptedAt: expect.any(Date) },
    })
    expect(revalidatePathFn).toHaveBeenCalledWith('/inbox')
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-company')
  })

  it('happy path asAdmin=true: crea membership y suma al preset group del place', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(makeInvitation({ asAdmin: true }))
    membershipFindFirstTx.mockResolvedValue(null)
    membershipCountTx.mockResolvedValue(0)
    membershipCreateTx.mockResolvedValue({})
    permissionGroupFindFirstTx.mockResolvedValue({ id: 'pg-preset-1' })
    groupMembershipCreateTx.mockResolvedValue({})
    invitationUpdateMany.mockResolvedValue({ count: 1 })

    await acceptInvitationAction(TOKEN)

    expect(membershipCreateTx).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        placeId: 'place-1',
      },
    })
    expect(permissionGroupFindFirstTx).toHaveBeenCalledWith({
      where: { placeId: 'place-1', isPreset: true },
      select: { id: true },
    })
    expect(groupMembershipCreateTx).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        placeId: 'place-1',
        groupId: 'pg-preset-1',
      },
    })
  })

  it('idempotencia dura: ya soy miembro activo del place (tx-side)', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(makeInvitation())
    membershipFindFirstTx.mockResolvedValue({ id: 'mem-1' })
    invitationUpdateMany.mockResolvedValue({ count: 1 })

    const res = await acceptInvitationAction(TOKEN)
    expect(res.alreadyMember).toBe(true)
    expect(membershipCountTx).not.toHaveBeenCalled()
    expect(membershipCreateTx).not.toHaveBeenCalled()
    // Igualmente se marca acceptedAt si estaba null (sincroniza estado).
    expect(invitationUpdateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', acceptedAt: null },
      data: { acceptedAt: expect.any(Date) },
    })
  })

  it('multi-place: solo toca el place objetivo (no se escriben otros placeIds)', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(makeInvitation())
    membershipFindFirstTx.mockResolvedValue(null)
    membershipCountTx.mockResolvedValue(0)
    membershipCreateTx.mockResolvedValue({})
    invitationUpdateMany.mockResolvedValue({ count: 1 })

    await acceptInvitationAction(TOKEN)

    // Todas las escrituras apuntan a placeId=place-1. Ningún otro placeId es referenciado.
    expect(membershipFindFirstTx).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ placeId: 'place-1' }),
      }),
    )
    expect(membershipCountTx).toHaveBeenCalledWith({
      where: { placeId: 'place-1', leftAt: null },
    })
    expect(membershipCreateTx).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ placeId: 'place-1' }) }),
    )
  })

  it('P2002 en Membership.create → ConflictError membership_conflict', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(makeInvitation())
    membershipFindFirstTx.mockResolvedValue(null)
    membershipCountTx.mockResolvedValue(0)
    membershipCreateTx.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique violation', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    )

    await expect(acceptInvitationAction(TOKEN)).rejects.toMatchObject({
      code: 'CONFLICT',
      context: expect.objectContaining({ reason: 'membership_conflict' }),
    })
  })
})
