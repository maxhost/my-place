import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const verifyOtpMock = vi.fn()
const signOutMock = vi.fn()
const userUpsertMock = vi.fn()
const setAllSpy = vi.fn()
const cookieStoreSetSpy = vi.fn()
const cleanupLegacyCookiesMock = vi.fn()

// Mock createSupabaseServer (patrón canónico Next 15 + Supabase SSR via
// `cookies()` de next/headers — ver `src/shared/lib/supabase/server.ts`).
const setSessionMock = vi.fn().mockResolvedValue({ data: null, error: null })

// Mock @supabase/ssr createServerClient (patrón directo con cookies adapter
// que escribe en response.cookies — necesario porque cookies() de next/headers
// no se mergea cuando el handler retorna su propio NextResponse).
vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { setAll: (c: unknown[]) => void } },
  ) => ({
    auth: {
      verifyOtp: (...a: unknown[]) => {
        const result = verifyOtpMock(...a)
        return Promise.resolve(result).then((r) => {
          if (r && !r.error && r.data?.user) {
            cookieStoreSetSpy('sb-test-auth-token', 'access_jwt', { path: '/' })
            // En runtime real, verifyOtp invoca el setAll del adapter via
            // onAuthStateChange listener — async. Acá simulamos sync para test.
            opts.cookies.setAll([
              { name: 'sb-test-auth-token', value: 'access_jwt', options: { path: '/' } },
            ])
            setAllSpy([{ name: 'sb-test-auth-token', value: 'access_jwt' }])
          }
          return r
        })
      },
      setSession: (...a: unknown[]) => setSessionMock(...a),
      signOut: (...a: unknown[]) => signOutMock(...a),
    },
  }),
}))

vi.mock('@/shared/lib/supabase/cookie-cleanup', () => ({
  cleanupLegacyCookies: (...a: unknown[]) => cleanupLegacyCookiesMock(...a),
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
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000', // APEX (post-S1)
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

function mkReq(query: Record<string, string>, host = 'localhost:3000'): NextRequest {
  const qs = new URLSearchParams(query).toString()
  const url = `http://${host}/auth/invite-callback${qs ? `?${qs}` : ''}`
  const req = new Request(url) as unknown as NextRequest
  // @ts-expect-error — NextRequest.cookies tiene shape distinto; mockeamos lo justo.
  req.cookies = { getAll: () => [] }
  return req
}

beforeEach(() => {
  verifyOtpMock.mockReset()
  signOutMock.mockReset()
  signOutMock.mockResolvedValue({ error: null })
  userUpsertMock.mockReset()
  setAllSpy.mockReset()
  cookieStoreSetSpy.mockReset()
  cleanupLegacyCookiesMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /auth/invite-callback', () => {
  it('sin token_hash → 307 a /login?error=invalid_link sin tocar Supabase', async () => {
    const res = await GET(mkReq({ type: 'invite', next: '/inbox' }))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('http://localhost:3000/login?error=invalid_link')
    expect(verifyOtpMock).not.toHaveBeenCalled()
    expect(userUpsertMock).not.toHaveBeenCalled()
  })

  it('type inválido → 307 a /login?error=invalid_link sin tocar Supabase', async () => {
    const res = await GET(mkReq({ token_hash: 'h', type: 'recovery', next: '/inbox' }))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('http://localhost:3000/login?error=invalid_link')
    expect(verifyOtpMock).not.toHaveBeenCalled()
  })

  it('type ausente → invalid_link', async () => {
    const res = await GET(mkReq({ token_hash: 'h', next: '/inbox' }))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('http://localhost:3000/login?error=invalid_link')
    expect(verifyOtpMock).not.toHaveBeenCalled()
  })

  it('verifyOtp falla → 307 a /login?error=invalid_link, sin upsert', async () => {
    verifyOtpMock.mockReturnValue({ data: null, error: { message: 'token expired' } })

    const res = await GET(mkReq({ token_hash: 'h', type: 'invite', next: '/inbox' }))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('http://localhost:3000/login?error=invalid_link')
    expect(verifyOtpMock).toHaveBeenCalledWith({ token_hash: 'h', type: 'invite' })
    expect(userUpsertMock).not.toHaveBeenCalled()
  })

  it('happy path invite: verifyOtp ok + upsert ok → 307 a apex /invite/accept (host-aware)', async () => {
    verifyOtpMock.mockReturnValue({
      data: {
        user: { id: 'usr-1', email: 'ana@example.com', user_metadata: {} },
        session: { access_token: 'at', refresh_token: 'rt' },
      },
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

    expect(res.status).toBe(200)
    // resolveNextRedirect mapea /invite/accept/<tok> → APEX (no subdomain).
    expect(await res.text()).toContain('http://localhost:3000/invite/accept/tok_abc')
    expect(verifyOtpMock).toHaveBeenCalledWith({
      token_hash: 'hash_invite_xyz',
      type: 'invite',
    })
    expect(userUpsertMock).toHaveBeenCalledTimes(1)

    // verifyOtp escribió cookies vía setAll del adapter de createSupabaseServer.
    expect(setAllSpy).toHaveBeenCalledTimes(1)
  })

  it('happy path magiclink (fallback path para users existentes)', async () => {
    verifyOtpMock.mockReturnValue({
      data: {
        user: { id: 'usr-2', email: 'bob@example.com', user_metadata: {} },
        session: { access_token: 'at', refresh_token: 'rt' },
      },
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

    expect(res.status).toBe(200)
    expect(verifyOtpMock).toHaveBeenCalledWith({
      token_hash: 'hash_magic_xyz',
      type: 'magiclink',
    })
  })

  it('next /<slug>/conversations → place subdomain (host-aware)', async () => {
    verifyOtpMock.mockReturnValue({
      data: {
        user: { id: 'usr-place', email: 'p@y.com', user_metadata: {} },
        session: { access_token: 'at', refresh_token: 'rt' },
      },
      error: null,
    })
    userUpsertMock.mockResolvedValue({})

    const res = await GET(
      mkReq({ token_hash: 'h', type: 'invite', next: '/the-company/conversations' }),
    )

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('http://the-company.localhost:3000/conversations')
  })

  it('next inválido (no en allowlist) → fallback al inbox subdomain root', async () => {
    verifyOtpMock.mockReturnValue({
      data: {
        user: { id: 'usr-3', email: 'x@y.com', user_metadata: {} },
        session: { access_token: 'at', refresh_token: 'rt' },
      },
      error: null,
    })
    userUpsertMock.mockResolvedValue({})

    const res = await GET(mkReq({ token_hash: 'h', type: 'invite', next: '/etc/passwd' }))

    expect(res.status).toBe(200)
    // resolveNextRedirect cae al fallback `inboxUrl('/')`.
    expect(await res.text()).toContain('http://app.localhost:3000/')
  })

  it('upsert User falla → signOut + 307 a /login?error=sync', async () => {
    verifyOtpMock.mockReturnValue({
      data: {
        user: { id: 'usr-4', email: 'fail@y.com', user_metadata: {} },
        session: { access_token: 'at', refresh_token: 'rt' },
      },
      error: null,
    })
    userUpsertMock.mockRejectedValue(new Error('db down'))

    const res = await GET(mkReq({ token_hash: 'h', type: 'invite', next: '/inbox' }))

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('http://localhost:3000/login?error=sync')
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  it('user con email null → upsert usa fallbackEmail derivado del userId', async () => {
    verifyOtpMock.mockReturnValue({
      data: {
        user: { id: 'usr-5', email: null, user_metadata: {} },
        session: { access_token: 'at', refresh_token: 'rt' },
      },
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

  it('cleanup legacy cookies invocado al inicio (defensa contra cookies viejas Domain=app.<apex>)', async () => {
    verifyOtpMock.mockReturnValue({
      data: {
        user: { id: 'usr-cleanup', email: 'c@y.com', user_metadata: {} },
        session: { access_token: 'at', refresh_token: 'rt' },
      },
      error: null,
    })
    userUpsertMock.mockResolvedValue({})

    await GET(mkReq({ token_hash: 'h', type: 'invite', next: '/inbox' }))

    expect(cleanupLegacyCookiesMock).toHaveBeenCalledTimes(1)
  })
})
