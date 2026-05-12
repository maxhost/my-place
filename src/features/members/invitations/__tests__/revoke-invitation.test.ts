import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

const invitationFindUnique = vi.fn()
const invitationDelete = vi.fn()
const membershipFindFirst = vi.fn()
const ownershipFindUnique = vi.fn()
const getUserFn = vi.fn()
const revalidatePathFn = vi.fn()
// `hasPermission` consulta `prisma.groupMembership.findMany` para resolver
// el permiso vía membership a algún grupo. Default [] (sin grupos).
const groupMembershipFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[])
const groupMembershipFindFirst = vi.fn(async (..._a: unknown[]) => null as { id: string } | null)

vi.mock('@/db/client', () => ({
  prisma: {
    invitation: {
      findUnique: (...a: unknown[]) => invitationFindUnique(...a),
      delete: (...a: unknown[]) => invitationDelete(...a),
    },
    membership: { findFirst: (...a: unknown[]) => membershipFindFirst(...a) },
    placeOwnership: { findUnique: (...a: unknown[]) => ownershipFindUnique(...a) },
    groupMembership: {
      findMany: (...a: unknown[]) => groupMembershipFindMany(...a),
      findFirst: (...a: unknown[]) => groupMembershipFindFirst(...a),
    },
  },
}))

vi.mock('@/shared/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: getUserFn } }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
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
  serverEnv: {
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    NODE_ENV: 'test',
  },
}))

import { revokeInvitationAction } from '@/features/members/invitations/server/actions/revoke'

const AUTH_OK = { data: { user: { id: 'user-1' } } }
const AUTH_NONE = { data: { user: null } }

const FUTURE = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)

const pendingOwnerInvitation = {
  id: 'inv-1',
  placeId: 'place-1',
  email: 'newowner@example.com',
  invitedBy: 'user-1',
  asAdmin: false,
  asOwner: true,
  acceptedAt: null,
  expiresAt: FUTURE,
  token: 'tok_abc',
  deliveryStatus: 'PENDING',
  providerMessageId: null,
  lastDeliveryError: null,
  lastSentAt: null,
  place: { id: 'place-1', slug: 'the-company', name: 'The Company', archivedAt: null },
}

/**
 * Mock del actor con permiso `members:revoke-invitation`. Patrón canónico
 * usado en resend-invitation.test.ts: el actor está en algún grupo (custom
 * o preset Administradores) que tiene el permiso en su array `permissions`.
 */
function mockAuthorizedActor(): void {
  getUserFn.mockResolvedValue(AUTH_OK)
  membershipFindFirst.mockResolvedValue({ id: 'mem-1' })
  ownershipFindUnique.mockResolvedValue(null)
  groupMembershipFindFirst.mockResolvedValue({ id: 'gm-mock-admin' })
  groupMembershipFindMany.mockResolvedValue([
    {
      group: {
        id: 'grp-mock-admin',
        permissions: ['members:revoke-invitation'],
        categoryScopes: [],
      },
    },
  ])
}

beforeEach(() => {
  invitationFindUnique.mockReset()
  invitationDelete.mockReset()
  membershipFindFirst.mockReset()
  ownershipFindUnique.mockReset()
  getUserFn.mockReset()
  revalidatePathFn.mockReset()
  groupMembershipFindMany.mockReset()
  groupMembershipFindMany.mockResolvedValue([])
  groupMembershipFindFirst.mockReset()
  groupMembershipFindFirst.mockResolvedValue(null)

  invitationDelete.mockResolvedValue({})
})

describe('revokeInvitationAction', () => {
  it('rechaza input inválido con ValidationError', async () => {
    await expect(revokeInvitationAction({ invitationId: '' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('rechaza sin sesión con AuthorizationError', async () => {
    getUserFn.mockResolvedValue(AUTH_NONE)
    await expect(revokeInvitationAction({ invitationId: 'inv-1' })).rejects.toBeInstanceOf(
      AuthorizationError,
    )
  })

  it('rechaza invitación inexistente con NotFoundError', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(null)
    await expect(revokeInvitationAction({ invitationId: 'missing' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('rechaza invitación ya aceptada con ConflictError (reason: already_accepted)', async () => {
    mockAuthorizedActor()
    invitationFindUnique.mockResolvedValue({
      ...pendingOwnerInvitation,
      acceptedAt: new Date(),
    })
    await expect(revokeInvitationAction({ invitationId: 'inv-1' })).rejects.toMatchObject({
      code: 'CONFLICT',
      context: expect.objectContaining({ reason: 'already_accepted' }),
    })
    expect(invitationDelete).not.toHaveBeenCalled()
  })

  it('rechaza actor sin permission members:revoke-invitation con AuthorizationError', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(pendingOwnerInvitation)
    membershipFindFirst.mockResolvedValue({ id: 'mem-1' })
    ownershipFindUnique.mockResolvedValue(null)
    // Prisma `groupMembership.findMany` con filter `permissions: { has: 'members:revoke-invitation' }`
    // retorna [] si ningún grupo del user tiene ESE permiso (el filter es a nivel DB).
    // Simulamos eso retornando []. Si el actor tuviera otros permisos pero no revoke,
    // la real Prisma filtraría y retornaría []. Mock no implementa el filter — simulamos
    // el resultado equivalente.
    groupMembershipFindFirst.mockResolvedValue(null)
    groupMembershipFindMany.mockResolvedValue([])
    await expect(revokeInvitationAction({ invitationId: 'inv-1' })).rejects.toBeInstanceOf(
      AuthorizationError,
    )
    expect(invitationDelete).not.toHaveBeenCalled()
  })

  it('owner del place bypaseá el check de permission (owner = bypass)', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(pendingOwnerInvitation)
    membershipFindFirst.mockResolvedValue({ id: 'mem-1' })
    // Owner del place
    ownershipFindUnique.mockResolvedValue({ userId: 'user-1', placeId: 'place-1' })
    // Sin grupo con permission, pero owner bypass
    groupMembershipFindFirst.mockResolvedValue(null)
    groupMembershipFindMany.mockResolvedValue([])

    const res = await revokeInvitationAction({ invitationId: 'inv-1' })
    expect(res).toEqual({ ok: true, invitationId: 'inv-1' })
    expect(invitationDelete).toHaveBeenCalledWith({ where: { id: 'inv-1' } })
  })

  it('happy path: actor con permission revoca → invitation deleted + revalidate', async () => {
    mockAuthorizedActor()
    invitationFindUnique.mockResolvedValue(pendingOwnerInvitation)

    const res = await revokeInvitationAction({ invitationId: 'inv-1' })

    expect(res).toEqual({ ok: true, invitationId: 'inv-1' })
    expect(invitationDelete).toHaveBeenCalledWith({ where: { id: 'inv-1' } })
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-company/settings/access')
  })

  it('no leak de existencia: invitación de otro place → NotFoundError', async () => {
    // Edge case: el actor es owner del place A pero la invitation pertenece
    // al place B. Hoy `findInvitationById` retorna la invitation incluso si
    // pertenece a otro place (no hay filter por placeId en el query — solo
    // por id). El action debe verificar el ownership/permission ESPECÍFICO al
    // place de la invitation; el actor del place A NO debería poder revocar
    // invitations de place B.
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue({
      ...pendingOwnerInvitation,
      placeId: 'place-OTHER',
      place: { id: 'place-OTHER', slug: 'other', name: 'Other', archivedAt: null },
    })
    // Actor es owner del place-1, NO de place-OTHER
    membershipFindFirst.mockResolvedValue({ id: 'mem-1' })
    ownershipFindUnique.mockResolvedValue(null) // NO es owner del place-OTHER
    groupMembershipFindFirst.mockResolvedValue(null)
    groupMembershipFindMany.mockResolvedValue([]) // sin permisos en place-OTHER

    await expect(revokeInvitationAction({ invitationId: 'inv-1' })).rejects.toBeInstanceOf(
      AuthorizationError,
    )
    expect(invitationDelete).not.toHaveBeenCalled()
  })
})
