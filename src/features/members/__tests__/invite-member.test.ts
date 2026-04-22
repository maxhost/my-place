import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Prisma, MembershipRole } from '@prisma/client'
import {
  AuthorizationError,
  ConflictError,
  InvariantViolation,
  InvitationEmailFailedError,
  InvitationLinkGenerationError,
  NotFoundError,
  ValidationError,
  isDomainError,
} from '@/shared/errors/domain-error'
import { FakeMailer, setMailer, resetMailer } from '@/shared/lib/mailer'

const placeFindUnique = vi.fn()
const membershipFindFirst = vi.fn()
const membershipCount = vi.fn()
const ownershipFindUnique = vi.fn()
const invitationCreate = vi.fn()
const invitationUpdate = vi.fn()
const userFindUnique = vi.fn()
const getUserFn = vi.fn()
const generateInviteMagicLinkMock = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
    membership: {
      findFirst: (...a: unknown[]) => membershipFindFirst(...a),
      count: (...a: unknown[]) => membershipCount(...a),
    },
    placeOwnership: { findUnique: (...a: unknown[]) => ownershipFindUnique(...a) },
    invitation: {
      create: (...a: unknown[]) => invitationCreate(...a),
      update: (...a: unknown[]) => invitationUpdate(...a),
    },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
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

import { inviteMemberAction } from '../server/actions'

const validInput = {
  placeSlug: 'the-company',
  email: 'ana@example.com',
  asAdmin: false,
}

const AUTH_OK = { data: { user: { id: 'user-1' } } }
const AUTH_NONE = { data: { user: null } }

let fakeMailer: FakeMailer

function mockAuthorized(): void {
  getUserFn.mockResolvedValue(AUTH_OK)
  placeFindUnique.mockResolvedValue({
    id: 'place-1',
    slug: 'the-company',
    name: 'The Company',
    archivedAt: null,
  })
  membershipFindFirst.mockResolvedValue({ role: MembershipRole.ADMIN })
  ownershipFindUnique.mockResolvedValue(null)
  membershipCount.mockResolvedValue(0)
  userFindUnique.mockResolvedValue({ displayName: 'Max' })
}

beforeEach(() => {
  placeFindUnique.mockReset()
  membershipFindFirst.mockReset()
  membershipCount.mockReset()
  ownershipFindUnique.mockReset()
  invitationCreate.mockReset()
  invitationUpdate.mockReset()
  userFindUnique.mockReset()
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

describe('inviteMemberAction — validación y autorización', () => {
  it('rechaza input inválido con ValidationError', async () => {
    await expect(inviteMemberAction({ placeSlug: '', email: 'x' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(getUserFn).not.toHaveBeenCalled()
  })

  it('rechaza sin sesión con AuthorizationError', async () => {
    getUserFn.mockResolvedValue(AUTH_NONE)
    await expect(inviteMemberAction(validInput)).rejects.toBeInstanceOf(AuthorizationError)
    expect(placeFindUnique).not.toHaveBeenCalled()
  })

  it('rechaza place inexistente con NotFoundError', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(null)
    await expect(inviteMemberAction(validInput)).rejects.toBeInstanceOf(NotFoundError)
    expect(invitationCreate).not.toHaveBeenCalled()
  })

  it('rechaza place archivado con ConflictError', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue({
      id: 'place-1',
      slug: 'the-company',
      name: 'The Company',
      archivedAt: new Date(),
    })
    await expect(inviteMemberAction(validInput)).rejects.toBeInstanceOf(ConflictError)
  })

  it('rechaza MEMBER simple (no admin ni owner) con AuthorizationError', async () => {
    mockAuthorized()
    membershipFindFirst.mockResolvedValue({ role: MembershipRole.MEMBER })
    ownershipFindUnique.mockResolvedValue(null)
    await expect(inviteMemberAction(validInput)).rejects.toBeInstanceOf(AuthorizationError)
    expect(invitationCreate).not.toHaveBeenCalled()
  })

  it('acepta owner sin membership activa (caso borde)', async () => {
    mockAuthorized()
    membershipFindFirst.mockResolvedValue(null)
    ownershipFindUnique.mockResolvedValue({ userId: 'user-1' })
    invitationCreate.mockResolvedValue({ id: 'inv-1' })
    generateInviteMagicLinkMock.mockResolvedValue({
      url: 'https://supabase/link?x=1',
      isNewAuthUser: true,
    })

    const res = await inviteMemberAction(validInput)
    expect(res.ok).toBe(true)
  })

  it('rechaza place en cap (150) con InvariantViolation', async () => {
    mockAuthorized()
    membershipCount.mockResolvedValue(150)
    await expect(inviteMemberAction(validInput)).rejects.toBeInstanceOf(InvariantViolation)
    expect(invitationCreate).not.toHaveBeenCalled()
  })

  it('unique parcial violado (P2002) → ConflictError "already_open"', async () => {
    mockAuthorized()
    invitationCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique violation', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    )

    await expect(inviteMemberAction(validInput)).rejects.toMatchObject({
      code: 'CONFLICT',
      context: expect.objectContaining({ reason: 'already_open' }),
    })
    expect(generateInviteMagicLinkMock).not.toHaveBeenCalled()
  })
})

describe('inviteMemberAction — flujo de delivery (Resend)', () => {
  it('happy path user nuevo: crea Invitation, genera link, FakeMailer captura, update SENT', async () => {
    mockAuthorized()
    invitationCreate.mockResolvedValue({ id: 'inv-1' })
    generateInviteMagicLinkMock.mockResolvedValue({
      url: 'https://supabase/invite?token=xyz',
      isNewAuthUser: true,
    })

    const res = await inviteMemberAction(validInput)
    expect(res).toEqual({ ok: true, invitationId: 'inv-1' })

    expect(invitationCreate).toHaveBeenCalledTimes(1)
    const createArgs = invitationCreate.mock.calls.at(0)?.[0] as {
      data: Record<string, unknown>
    }
    expect(createArgs.data).toMatchObject({
      placeId: 'place-1',
      email: 'ana@example.com',
      invitedBy: 'user-1',
      asAdmin: false,
    })
    expect(createArgs.data.token).toMatch(/^[A-Za-z0-9_-]{43}$/)

    expect(generateInviteMagicLinkMock).toHaveBeenCalledWith({
      email: 'ana@example.com',
      redirectTo: expect.stringMatching(
        /^http:\/\/lvh\.me:3000\/invite\/accept\/[A-Za-z0-9_-]{43}$/,
      ) as unknown,
    })

    expect(fakeMailer.captures).toHaveLength(1)
    expect(fakeMailer.lastInvitation).toMatchObject({
      to: 'ana@example.com',
      placeName: 'The Company',
      placeSlug: 'the-company',
      inviterDisplayName: 'Max',
      inviteUrl: 'https://supabase/invite?token=xyz',
    })

    const sentUpdate = invitationUpdate.mock.calls.at(-1)?.[0] as {
      where: { id: string }
      data: Record<string, unknown>
    }
    expect(sentUpdate.where.id).toBe('inv-1')
    expect(sentUpdate.data).toMatchObject({
      deliveryStatus: 'SENT',
      lastDeliveryError: null,
    })
    expect(sentUpdate.data.providerMessageId).toMatch(/^fake_inv_/)

    expect(revalidatePathFn).toHaveBeenCalledWith('/the-company/settings/members')
  })

  it('happy path user existente: generateLink hace fallback (isNewAuthUser=false), envío ok', async () => {
    mockAuthorized()
    invitationCreate.mockResolvedValue({ id: 'inv-2' })
    generateInviteMagicLinkMock.mockResolvedValue({
      url: 'https://supabase/magiclink?token=abc',
      isNewAuthUser: false,
    })

    const res = await inviteMemberAction(validInput)
    expect(res.ok).toBe(true)
    expect(fakeMailer.lastInvitation?.inviteUrl).toBe('https://supabase/magiclink?token=abc')
    const sentUpdate = invitationUpdate.mock.calls.at(-1)?.[0] as {
      data: { deliveryStatus: string }
    }
    expect(sentUpdate.data.deliveryStatus).toBe('SENT')
  })

  it('generateLink falla → update FAILED + re-throw InvitationLinkGenerationError', async () => {
    mockAuthorized()
    invitationCreate.mockResolvedValue({ id: 'inv-3' })
    generateInviteMagicLinkMock.mockRejectedValue(
      new InvitationLinkGenerationError('supabase downstream 500'),
    )

    await expect(inviteMemberAction(validInput)).rejects.toSatisfy((err) => {
      return isDomainError(err) && err.code === 'INVITATION_LINK_GENERATION'
    })

    const failedUpdate = invitationUpdate.mock.calls.at(-1)?.[0] as {
      where: { id: string }
      data: Record<string, unknown>
    }
    expect(failedUpdate.where.id).toBe('inv-3')
    expect(failedUpdate.data).toMatchObject({ deliveryStatus: 'FAILED' })
    expect(failedUpdate.data.lastDeliveryError).toMatch(/^link: /)
    expect(fakeMailer.captures).toHaveLength(0)
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })

  it('mailer falla → update FAILED + InvitationEmailFailedError', async () => {
    mockAuthorized()
    invitationCreate.mockResolvedValue({ id: 'inv-4' })
    generateInviteMagicLinkMock.mockResolvedValue({
      url: 'https://supabase/invite?token=zzz',
      isNewAuthUser: true,
    })

    const throwingMailer = {
      sendInvitation: vi.fn().mockRejectedValue(new Error('resend 503 Service Unavailable')),
    }
    setMailer(throwingMailer)

    await expect(inviteMemberAction(validInput)).rejects.toBeInstanceOf(InvitationEmailFailedError)

    const failedUpdate = invitationUpdate.mock.calls.at(-1)?.[0] as {
      data: Record<string, unknown>
    }
    expect(failedUpdate.data).toMatchObject({ deliveryStatus: 'FAILED' })
    expect(failedUpdate.data.lastDeliveryError).toMatch(/^mailer: /)
  })
})

describe('inviteMemberAction — persistencia', () => {
  it('asAdmin=true persiste el flag', async () => {
    mockAuthorized()
    invitationCreate.mockResolvedValue({ id: 'inv-5' })
    generateInviteMagicLinkMock.mockResolvedValue({
      url: 'https://supabase/invite?token=xyz',
      isNewAuthUser: true,
    })

    await inviteMemberAction({ ...validInput, asAdmin: true })
    const args = invitationCreate.mock.calls.at(0)?.[0] as { data: { asAdmin: boolean } }
    expect(args.data.asAdmin).toBe(true)
  })
})
