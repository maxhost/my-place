import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  AuthorizationError,
  ConflictError,
  InvariantViolation,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'
import { ADMIN_PRESET_NAME } from '@/features/groups/public'

const invitationFindUnique = vi.fn()
const invitationUpdateMany = vi.fn()
const membershipFindFirstTop = vi.fn() // findActiveMembership (outside tx)
const membershipFindFirstTx = vi.fn() // inside tx
const membershipCountTx = vi.fn() // inside tx
const membershipCreateTx = vi.fn() // inside tx
const permissionGroupFindFirstTx = vi.fn() // G.3: lookup preset Administradores
const groupMembershipCreateTx = vi.fn() // G.3: insertar al preset
const placeOwnershipCreateTx = vi.fn() // asOwner=true: crear PlaceOwnership en tx
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
  // Plan #2.3: `findInviterPermissions` ahora envuelve con `unstable_cache`
  // y los actions invalidan via `revalidateTag`. Los tests sólo verifican
  // que se llamen — passthrough en cache, no-op en tag.
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

import { acceptInvitationAction } from '@/features/members/invitations/server/actions/accept'

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
    asOwner: false,
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
  placeOwnershipCreateTx.mockReset()
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
      // G.3: tx también accede a permissionGroup + groupMembership cuando
      // la invitation tiene asAdmin=true o asOwner=true.
      permissionGroup: { findFirst: permissionGroupFindFirstTx },
      groupMembership: { create: groupMembershipCreateTx },
      // asOwner=true crea PlaceOwnership además de Membership.
      placeOwnership: { create: placeOwnershipCreateTx },
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

  it('happy path MEMBER: crea membership y marca acceptedAt', async () => {
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
    expect(invitationUpdateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', acceptedAt: null },
      data: { acceptedAt: expect.any(Date) },
    })
    expect(revalidatePathFn).toHaveBeenCalledWith('/inbox')
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-company')
    // Invalida el subtree del layout `[placeSlug]` para que el TopBar trigger
    // (gateado por isAdmin del layout RSC) refleje los nuevos perms del actor.
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-company', 'layout')
  })

  it('happy path asAdmin=true: crea membership MEMBER + GroupMembership al preset Administradores (G.3 ADR #1.bis)', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(makeInvitation({ asAdmin: true }))
    membershipFindFirstTx.mockResolvedValue(null)
    membershipCountTx.mockResolvedValue(0)
    membershipCreateTx.mockResolvedValue({})
    permissionGroupFindFirstTx.mockResolvedValue({ id: 'grp-admin-preset' })
    groupMembershipCreateTx.mockResolvedValue({})
    invitationUpdateMany.mockResolvedValue({ count: 1 })

    await acceptInvitationAction(TOKEN)

    // G.3 (decisión ADR #1.bis): Membership.role siempre se crea como MEMBER;
    // la invitación con asAdmin=true se materializa como GroupMembership al
    // grupo preset "Administradores".
    expect(membershipCreateTx).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        placeId: 'place-1',
      },
    })
    expect(permissionGroupFindFirstTx).toHaveBeenCalledWith({
      where: {
        placeId: 'place-1',
        isPreset: true,
        name: ADMIN_PRESET_NAME,
      },
      select: { id: true },
    })
    expect(groupMembershipCreateTx).toHaveBeenCalledWith({
      data: {
        groupId: 'grp-admin-preset',
        userId: 'user-1',
        placeId: 'place-1',
        addedByUserId: 'admin-1',
      },
    })
  })

  it('asAdmin=true sin preset Administradores: ConflictError (G.3 defensa)', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(makeInvitation({ asAdmin: true }))
    membershipFindFirstTx.mockResolvedValue(null)
    membershipCountTx.mockResolvedValue(0)
    membershipCreateTx.mockResolvedValue({})
    permissionGroupFindFirstTx.mockResolvedValue(null)

    await expect(acceptInvitationAction(TOKEN)).rejects.toBeInstanceOf(ConflictError)
    expect(groupMembershipCreateTx).not.toHaveBeenCalled()
  })

  it('happy path asOwner=true: crea Membership + GroupMembership al preset + PlaceOwnership', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(makeInvitation({ asOwner: true }))
    membershipFindFirstTx.mockResolvedValue(null)
    membershipCountTx.mockResolvedValue(0)
    membershipCreateTx.mockResolvedValue({})
    permissionGroupFindFirstTx.mockResolvedValue({ id: 'grp-admin-preset' })
    groupMembershipCreateTx.mockResolvedValue({})
    placeOwnershipCreateTx.mockResolvedValue({})
    invitationUpdateMany.mockResolvedValue({ count: 1 })

    await acceptInvitationAction(TOKEN)

    // Owner-invite implica admin: el accept inserta GroupMembership al preset
    // (por consistencia con `places/server/actions.ts:createPlace` — owners
    // existentes ya están en el preset). Y además inserta PlaceOwnership en
    // la misma tx para que el viewer quede materializado como co-owner.
    expect(membershipCreateTx).toHaveBeenCalledWith({
      data: { userId: 'user-1', placeId: 'place-1' },
    })
    expect(groupMembershipCreateTx).toHaveBeenCalledWith({
      data: {
        groupId: 'grp-admin-preset',
        userId: 'user-1',
        placeId: 'place-1',
        addedByUserId: 'admin-1',
      },
    })
    expect(placeOwnershipCreateTx).toHaveBeenCalledWith({
      data: { userId: 'user-1', placeId: 'place-1' },
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
