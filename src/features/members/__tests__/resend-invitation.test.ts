import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { FakeMailer, setMailer, resetMailer } from '@/shared/lib/mailer'

const invitationFindUnique = vi.fn()
const invitationUpdate = vi.fn()
const membershipFindFirst = vi.fn()
const ownershipFindUnique = vi.fn()
const userFindUnique = vi.fn()
const groupMembershipFindFirst = vi.fn()
const getUserFn = vi.fn()
const generateInviteMagicLinkMock = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    invitation: {
      findUnique: (...a: unknown[]) => invitationFindUnique(...a),
      update: (...a: unknown[]) => invitationUpdate(...a),
    },
    membership: { findFirst: (...a: unknown[]) => membershipFindFirst(...a) },
    placeOwnership: { findUnique: (...a: unknown[]) => ownershipFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    groupMembership: {
      findFirst: (...a: unknown[]) => groupMembershipFindFirst(...a),
    },
  },
}))

vi.mock('@/shared/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: getUserFn } }),
}))

vi.mock('@/shared/lib/supabase/admin-links', () => ({
  generateInviteMagicLink: (...a: unknown[]) => generateInviteMagicLinkMock(...a),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
  // Plan #2.3: findInviterPermissions envuelve con unstable_cache.
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

import { resendInvitationAction } from '../server/actions'

const AUTH_OK = { data: { user: { id: 'user-1' } } }
const AUTH_NONE = { data: { user: null } }

const FUTURE = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
const PAST = new Date(Date.now() - 1000)

const pendingInvitation = {
  id: 'inv-1',
  placeId: 'place-1',
  email: 'ana@example.com',
  invitedBy: 'user-1',
  asAdmin: false,
  acceptedAt: null,
  expiresAt: FUTURE,
  token: 'tok_abc',
  deliveryStatus: 'PENDING',
  providerMessageId: null,
  lastDeliveryError: null,
  lastSentAt: null,
  place: { id: 'place-1', slug: 'the-company', name: 'The Company', archivedAt: null },
}

let fakeMailer: FakeMailer

function mockAuthorizedAdmin(): void {
  getUserFn.mockResolvedValue(AUTH_OK)
  membershipFindFirst.mockResolvedValue({ id: 'm-1' })
  ownershipFindUnique.mockResolvedValue(null)
  groupMembershipFindFirst.mockResolvedValue({ id: 'gm-mock' })
  userFindUnique.mockResolvedValue({ displayName: 'Max' })
}

beforeEach(() => {
  invitationFindUnique.mockReset()
  invitationUpdate.mockReset()
  membershipFindFirst.mockReset()
  ownershipFindUnique.mockReset()
  userFindUnique.mockReset()
  groupMembershipFindFirst.mockReset()
  getUserFn.mockReset()
  generateInviteMagicLinkMock.mockReset()
  revalidatePathFn.mockReset()

  invitationUpdate.mockResolvedValue({})

  fakeMailer = new FakeMailer()
  setMailer(fakeMailer)
})

afterEach(() => {
  resetMailer()
})

describe('resendInvitationAction', () => {
  it('rechaza input inválido con ValidationError', async () => {
    await expect(resendInvitationAction({ invitationId: '' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('rechaza sin sesión con AuthorizationError', async () => {
    getUserFn.mockResolvedValue(AUTH_NONE)
    await expect(resendInvitationAction({ invitationId: 'inv-1' })).rejects.toBeInstanceOf(
      AuthorizationError,
    )
  })

  it('rechaza invitación inexistente con NotFoundError', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(null)
    await expect(resendInvitationAction({ invitationId: 'missing' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('rechaza invitación ya aceptada con ConflictError', async () => {
    mockAuthorizedAdmin()
    invitationFindUnique.mockResolvedValue({
      ...pendingInvitation,
      acceptedAt: new Date(),
    })
    await expect(resendInvitationAction({ invitationId: 'inv-1' })).rejects.toMatchObject({
      code: 'CONFLICT',
      context: expect.objectContaining({ reason: 'already_accepted' }),
    })
  })

  it('rechaza invitación vencida con ValidationError', async () => {
    mockAuthorizedAdmin()
    invitationFindUnique.mockResolvedValue({ ...pendingInvitation, expiresAt: PAST })
    await expect(resendInvitationAction({ invitationId: 'inv-1' })).rejects.toMatchObject({
      code: 'VALIDATION',
      context: expect.objectContaining({ reason: 'expired' }),
    })
  })

  it('rechaza miembro sin permiso de admin con AuthorizationError', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    invitationFindUnique.mockResolvedValue(pendingInvitation)
    membershipFindFirst.mockResolvedValue({ id: 'm-1' })
    ownershipFindUnique.mockResolvedValue(null)
    groupMembershipFindFirst.mockResolvedValue(null)
    await expect(resendInvitationAction({ invitationId: 'inv-1' })).rejects.toBeInstanceOf(
      AuthorizationError,
    )
  })

  it('happy path: regenera link, envía, update SENT + lastSentAt', async () => {
    mockAuthorizedAdmin()
    invitationFindUnique.mockResolvedValue(pendingInvitation)
    generateInviteMagicLinkMock.mockResolvedValue({
      url: 'https://supabase/magic?token=new',
      isNewAuthUser: false,
    })

    const res = await resendInvitationAction({ invitationId: 'inv-1' })
    expect(res).toEqual({ ok: true, invitationId: 'inv-1' })

    expect(generateInviteMagicLinkMock).toHaveBeenCalledWith({
      email: 'ana@example.com',
      redirectTo: 'http://lvh.me:3000/invite/accept/tok_abc',
    })

    expect(fakeMailer.captures).toHaveLength(1)
    expect(fakeMailer.lastInvitation?.inviteUrl).toBe('https://supabase/magic?token=new')

    const update = invitationUpdate.mock.calls.at(-1)?.[0] as {
      data: Record<string, unknown>
    }
    expect(update.data.deliveryStatus).toBe('SENT')
    expect(update.data.providerMessageId).toMatch(/^fake_inv_/)
    expect(update.data.lastSentAt).toBeInstanceOf(Date)

    expect(revalidatePathFn).toHaveBeenCalledWith('/the-company/settings/members')
  })
})
