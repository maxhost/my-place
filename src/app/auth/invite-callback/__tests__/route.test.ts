import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const verifyOtpMock = vi.fn()
const signOutMock = vi.fn()
const userUpsertMock = vi.fn()
const setCookieSpy = vi.fn()

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { setAll: (c: unknown[]) => void } },
  ) => {
    // Simula el flow real: verifyOtp aplica setAll con las cookies de sesión.
    // El handler escucha esas cookies y las escribe al response.
    return {
      auth: {
        verifyOtp: async (...a: unknown[]) => {
          const result = await verifyOtpMock(...a)
          if (!result.error && result.data?.user) {
            opts.cookies.setAll([
              {
                name: 'sb-access-token',
                value: 'access_jwt',
                options: { path: '/', httpOnly: true },
              },
            ])
          }
          return result
        },
        signOut: (...a: unknown[]) => signOutMock(...a),
      },
    }
  },
}))

vi.mock('@/db/client', () => ({
  prisma: {
    user: {
      upsert: (...a: unknown[]) => userUpsertMock(...a),
    },
  },
}))

vi.mock('@/shared/config/env', () => ({
  clientEnv: {
    NEXT_PUBLIC_APP_URL: 'http://app.localhost:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'localhost:3000',
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  },
}))

vi.mock('@/shared/lib/logger', () => {
  const child = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return {
    logger: { child: vi.fn(() => child) },
  }
})

vi.mock('server-only', () => ({}))

import { GET } from '../route'
import type { NextRequest } from 'next/server'

function mkReq(query: Record<string, string>): NextRequest {
  const qs = new URLSearchParams(query).toString()
  const url = `http://app.localhost:3000/auth/invite-callback${qs ? `?${qs}` : ''}`
  // NextRequest acepta un Request normal; sólo necesitamos url + headers + cookies.getAll().
  const req = new Request(url) as unknown as NextRequest
  // @ts-expect-error — NextRequest.cookies tiene shape distinto a Request cookies; mockeamos lo justo.
  req.cookies = { getAll: () => [] }
  return req
}

beforeEach(() => {
  verifyOtpMock.mockReset()
  signOutMock.mockReset()
  // Default a promise resuelta — el handler hace `.catch(() => {})` post-sync error.
  signOutMock.mockResolvedValue({ error: null })
  userUpsertMock.mockReset()
  setCookieSpy.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /auth/invite-callback', () => {
  it('sin token_hash → 307 a /login?error=invalid_link sin tocar Supabase', async () => {
    const res = await GET(mkReq({ type: 'invite', next: '/inbox' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://app.localhost:3000/login?error=invalid_link')
    expect(verifyOtpMock).not.toHaveBeenCalled()
    expect(userUpsertMock).not.toHaveBeenCalled()
  })

  it('type inválido → 307 a /login?error=invalid_link sin tocar Supabase', async () => {
    const res = await GET(mkReq({ token_hash: 'h', type: 'recovery', next: '/inbox' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://app.localhost:3000/login?error=invalid_link')
    expect(verifyOtpMock).not.toHaveBeenCalled()
  })

  it('type ausente → invalid_link', async () => {
    const res = await GET(mkReq({ token_hash: 'h', next: '/inbox' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://app.localhost:3000/login?error=invalid_link')
    expect(verifyOtpMock).not.toHaveBeenCalled()
  })

  it('verifyOtp falla → 307 a /login?error=invalid_link, sin upsert', async () => {
    verifyOtpMock.mockResolvedValue({ data: null, error: { message: 'token expired' } })

    const res = await GET(mkReq({ token_hash: 'h', type: 'invite', next: '/inbox' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://app.localhost:3000/login?error=invalid_link')
    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: 'h', type: 'invite' })
    expect(userUpsertMock).not.toHaveBeenCalled()
  })

  it('happy path invite: verifyOtp ok + upsert ok → 307 a next con cookies seteadas', async () => {
    verifyOtpMock.mockResolvedValue({
      data: { user: { id: 'usr-1', email: 'ana@example.com', user_metadata: {} } },
      error: null,
    })
    userUpsertMock.mockResolvedValue({})

    const res = await GET(
      mkReq({
        token_hash: 'hash_invite_xyz',
        type: 'invite',
        next: '/invite/accept/tok_abc',
      }),
    )

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://app.localhost:3000/invite/accept/tok_abc')
    expect(verifyOtpMock).toHaveBeenCalledWith({
      token_hash: 'hash_invite_xyz',
      type: 'invite',
    })
    expect(userUpsertMock).toHaveBeenCalledTimes(1)

    // Las cookies de sesión escritas vía setAll deben aparecer en el response.
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('sb-access-token=access_jwt')
    // domain=localhost (cookieDomain strippea el puerto).
    expect(setCookie).toContain('Domain=localhost')
  })

  it('happy path magiclink (fallback path para users existentes)', async () => {
    verifyOtpMock.mockResolvedValue({
      data: { user: { id: 'usr-2', email: 'bob@example.com', user_metadata: {} } },
      error: null,
    })
    userUpsertMock.mockResolvedValue({})

    const res = await GET(
      mkReq({
        token_hash: 'hash_magic_xyz',
        type: 'magiclink',
        next: '/invite/accept/tok_xyz',
      }),
    )

    expect(res.status).toBe(307)
    expect(verifyOtpMock).toHaveBeenCalledWith({
      token_hash: 'hash_magic_xyz',
      type: 'magiclink',
    })
  })

  it('next inválido (no en allowlist) → fallback al inbox', async () => {
    verifyOtpMock.mockResolvedValue({
      data: { user: { id: 'usr-3', email: 'x@y.com', user_metadata: {} } },
      error: null,
    })
    userUpsertMock.mockResolvedValue({})

    const res = await GET(mkReq({ token_hash: 'h', type: 'invite', next: '/etc/passwd' }))

    expect(res.status).toBe(307)
    // Cae al fallback (inbox). El handler de helpers.ts loguea warn separado.
    expect(res.headers.get('location')).toBe('http://app.localhost:3000/')
  })

  it('upsert User falla → signOut + 307 a /login?error=sync', async () => {
    verifyOtpMock.mockResolvedValue({
      data: { user: { id: 'usr-4', email: 'fail@y.com', user_metadata: {} } },
      error: null,
    })
    userUpsertMock.mockRejectedValue(new Error('db down'))

    const res = await GET(mkReq({ token_hash: 'h', type: 'invite', next: '/inbox' }))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://app.localhost:3000/login?error=sync')
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  it('user con email null → upsert usa fallbackEmail derivado del userId', async () => {
    verifyOtpMock.mockResolvedValue({
      data: { user: { id: 'usr-5', email: null, user_metadata: {} } },
      error: null,
    })
    userUpsertMock.mockResolvedValue({})

    await GET(mkReq({ token_hash: 'h', type: 'invite', next: '/inbox' }))

    const upsertCall = userUpsertMock.mock.calls[0]?.[0] as {
      create: { email: string; displayName: string }
      update: Record<string, unknown>
    }
    expect(upsertCall.create.email).toBe('usr-5@noemail.place.local')
    expect(upsertCall.update).toEqual({})
  })
})
