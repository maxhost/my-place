import { describe, expect, it, beforeEach, vi } from 'vitest'
import { isDomainError } from '@/shared/errors/domain-error'

const generateLinkMock = vi.fn()

vi.mock('./admin', () => ({
  createSupabaseAdmin: () => ({
    auth: {
      admin: { generateLink: generateLinkMock },
    },
  }),
}))

import { generateInviteMagicLink } from './admin-links'

function okResponse(url: string, hashedToken = 'hash_default') {
  return {
    data: {
      properties: { action_link: url, hashed_token: hashedToken },
      user: { id: 'user-x' },
    },
    error: null,
  }
}

function errResponse(overrides: { status?: number; message?: string; code?: string }) {
  return {
    data: null,
    error: {
      status: overrides.status,
      message: overrides.message ?? 'error',
      code: overrides.code,
      name: 'AuthApiError',
    },
  }
}

// Post 2026-05-10 fix (Approach C): redirectTo es opcional. El email del
// invite usa `hashed_token` server-side via /auth/invite-callback, no el
// `action_link` de Supabase. Mantenemos el field por compat futura (otros
// flows que sigan dependiendo del action_link).
const INPUT = {
  email: 'maria@example.com',
}

describe('generateInviteMagicLink', () => {
  beforeEach(() => {
    generateLinkMock.mockReset()
  })

  it('user nuevo: invite OK devuelve URL + hashedToken + type=invite + isNewAuthUser=true', async () => {
    generateLinkMock.mockResolvedValueOnce(
      okResponse('https://supabase/auth/invite?token=xyz', 'hash_invite'),
    )

    const result = await generateInviteMagicLink(INPUT)

    expect(generateLinkMock).toHaveBeenCalledTimes(1)
    expect(generateLinkMock).toHaveBeenCalledWith({
      type: 'invite',
      email: INPUT.email,
      options: {},
    })
    expect(result).toEqual({
      url: 'https://supabase/auth/invite?token=xyz',
      hashedToken: 'hash_invite',
      type: 'invite',
      isNewAuthUser: true,
    })
  })

  it('user existente: invite 422 email_exists → fallback magiclink OK con type=magiclink', async () => {
    generateLinkMock
      .mockResolvedValueOnce(errResponse({ status: 422, code: 'email_exists' }))
      .mockResolvedValueOnce(okResponse('https://supabase/auth/magic?token=abc', 'hash_magic'))

    const result = await generateInviteMagicLink(INPUT)

    expect(generateLinkMock).toHaveBeenCalledTimes(2)
    expect(generateLinkMock).toHaveBeenNthCalledWith(2, {
      type: 'magiclink',
      email: INPUT.email,
      options: {},
    })
    expect(result).toEqual({
      url: 'https://supabase/auth/magic?token=abc',
      hashedToken: 'hash_magic',
      type: 'magiclink',
      isNewAuthUser: false,
    })
  })

  it('user existente por message (sin code): fallback igual', async () => {
    generateLinkMock
      .mockResolvedValueOnce(
        errResponse({
          status: 422,
          message: 'A user with this email address has already been registered',
        }),
      )
      .mockResolvedValueOnce(okResponse('https://supabase/auth/magic?token=abc'))

    const result = await generateInviteMagicLink(INPUT)

    expect(result.isNewAuthUser).toBe(false)
    expect(result.type).toBe('magiclink')
  })

  it('redirectTo opcional: si se pasa, se forwardea a Supabase en options', async () => {
    generateLinkMock.mockResolvedValueOnce(okResponse('https://supabase/auth/invite?token=x'))

    await generateInviteMagicLink({
      ...INPUT,
      redirectTo: 'https://example.com/r',
    })

    expect(generateLinkMock).toHaveBeenCalledWith({
      type: 'invite',
      email: INPUT.email,
      options: { redirectTo: 'https://example.com/r' },
    })
  })

  it('success sin hashed_token tira error tipado', async () => {
    generateLinkMock.mockResolvedValueOnce({
      data: { properties: { action_link: 'https://x' } },
      error: null,
    })

    await expect(generateInviteMagicLink(INPUT)).rejects.toSatisfy((err) => {
      return (
        isDomainError(err) &&
        err.code === 'INVITATION_LINK_GENERATION' &&
        err.message.includes('hashed_token')
      )
    })
  })

  it('fallback magiclink también falla → InvitationLinkGenerationError', async () => {
    generateLinkMock
      .mockResolvedValueOnce(errResponse({ status: 422, code: 'email_exists' }))
      .mockResolvedValueOnce(errResponse({ status: 500, message: 'downstream down' }))

    await expect(generateInviteMagicLink(INPUT)).rejects.toSatisfy((err) => {
      return (
        isDomainError(err) &&
        err.code === 'INVITATION_LINK_GENERATION' &&
        err.message.includes('magiclink') &&
        err.message.includes('downstream down')
      )
    })
  })

  it('error no-422 en invite → no fallback, tira error tipado', async () => {
    generateLinkMock.mockResolvedValueOnce(errResponse({ status: 500, message: 'gateway timeout' }))

    await expect(generateInviteMagicLink(INPUT)).rejects.toSatisfy((err) => {
      return (
        isDomainError(err) &&
        err.code === 'INVITATION_LINK_GENERATION' &&
        err.message.includes('gateway timeout')
      )
    })
    expect(generateLinkMock).toHaveBeenCalledTimes(1)
  })

  it('success sin action_link tira error tipado', async () => {
    generateLinkMock.mockResolvedValueOnce({
      data: { properties: {} },
      error: null,
    })

    await expect(generateInviteMagicLink(INPUT)).rejects.toSatisfy((err) => {
      return (
        isDomainError(err) &&
        err.code === 'INVITATION_LINK_GENERATION' &&
        err.message.includes('action_link')
      )
    })
  })
})
