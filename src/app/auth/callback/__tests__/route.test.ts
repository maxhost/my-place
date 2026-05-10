import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const exchangeCodeForSessionMock = vi.fn()
const signOutMock = vi.fn()
const userUpsertMock = vi.fn()
const setAllSpy = vi.fn()
const cleanupLegacyCookiesMock = vi.fn()

const setSessionMock = vi.fn().mockResolvedValue({ data: null, error: null })

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { setAll: (c: unknown[]) => void } },
  ) => ({
    auth: {
      exchangeCodeForSession: (...a: unknown[]) => {
        const result = exchangeCodeForSessionMock(...a)
        return Promise.resolve(result).then((r) => {
          if (r && !r.error && r.data?.user) {
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
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
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
  const url = `http://localhost:3000/auth/callback${qs ? `?${qs}` : ''}`
  const req = new Request(url) as unknown as NextRequest
  // @ts-expect-error — NextRequest.cookies tiene shape distinto; mockeamos lo justo.
  req.cookies = { getAll: () => [] }
  return req
}

beforeEach(() => {
  exchangeCodeForSessionMock.mockReset()
  signOutMock.mockReset()
  signOutMock.mockResolvedValue({ error: null })
  userUpsertMock.mockReset()
  setAllSpy.mockReset()
  cleanupLegacyCookiesMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /auth/callback (PKCE)', () => {
  it('sin code → 307 a /login?error=invalid_link sin tocar Supabase', async () => {
    const res = await GET(mkReq({ next: '/inbox' }))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('http://localhost:3000/login?error=invalid_link')
    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled()
    expect(userUpsertMock).not.toHaveBeenCalled()
  })

  it('exchangeCodeForSession falla → 307 a /login?error=invalid_link, sin upsert', async () => {
    exchangeCodeForSessionMock.mockReturnValue({
      data: null,
      error: { message: 'code expired' },
    })

    const res = await GET(mkReq({ code: 'bad_code', next: '/inbox' }))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('http://localhost:3000/login?error=invalid_link')
    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith('bad_code')
    expect(userUpsertMock).not.toHaveBeenCalled()
  })

  it('happy path: exchange ok + upsert ok → 307 a inbox subdomain root (host-aware)', async () => {
    exchangeCodeForSessionMock.mockReturnValue({
      data: {
        user: { id: 'usr-1', email: 'ana@example.com', user_metadata: {} },
        session: { access_token: 'at', refresh_token: 'rt' },
      },
      error: null,
    })
    userUpsertMock.mockResolvedValue({})

    const res = await GET(mkReq({ code: 'ok_code', next: '/inbox' }))

    expect(res.status).toBe(200)
    // resolveNextRedirect mapea /inbox → root del subdomain inbox.
    expect(await res.text()).toContain('http://app.localhost:3000/')
    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith('ok_code')
    expect(userUpsertMock).toHaveBeenCalledTimes(1)
    expect(setAllSpy).toHaveBeenCalledTimes(1)
  })

  it('next /<slug>/conversations → place subdomain (host-aware)', async () => {
    exchangeCodeForSessionMock.mockReturnValue({
      data: {
        user: { id: 'usr-place', email: 'p@y.com', user_metadata: {} },
        session: { access_token: 'at', refresh_token: 'rt' },
      },
      error: null,
    })
    userUpsertMock.mockResolvedValue({})

    const res = await GET(mkReq({ code: 'ok', next: '/the-company/conversations' }))

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('http://the-company.localhost:3000/conversations')
  })

  it('next /invite/accept/<tok> → apex (host-aware, paths globales)', async () => {
    exchangeCodeForSessionMock.mockReturnValue({
      data: {
        user: { id: 'usr-i', email: 'i@y.com', user_metadata: {} },
        session: { access_token: 'at', refresh_token: 'rt' },
      },
      error: null,
    })
    userUpsertMock.mockResolvedValue({})

    const res = await GET(mkReq({ code: 'ok', next: '/invite/accept/tok_abc' }))

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('http://localhost:3000/invite/accept/tok_abc')
  })

  it('next inválido → fallback al inbox subdomain root', async () => {
    exchangeCodeForSessionMock.mockReturnValue({
      data: {
        user: { id: 'usr-3', email: 'x@y.com', user_metadata: {} },
        session: { access_token: 'at', refresh_token: 'rt' },
      },
      error: null,
    })
    userUpsertMock.mockResolvedValue({})

    const res = await GET(mkReq({ code: 'ok', next: '/etc/passwd' }))

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('http://app.localhost:3000/')
  })

  it('upsert User falla → signOut + 307 a /login?error=sync', async () => {
    exchangeCodeForSessionMock.mockReturnValue({
      data: {
        user: { id: 'usr-4', email: 'fail@y.com', user_metadata: {} },
        session: { access_token: 'at', refresh_token: 'rt' },
      },
      error: null,
    })
    userUpsertMock.mockRejectedValue(new Error('db down'))

    const res = await GET(mkReq({ code: 'ok', next: '/inbox' }))

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('http://localhost:3000/login?error=sync')
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })

  it('cleanup legacy cookies invocado al inicio', async () => {
    exchangeCodeForSessionMock.mockReturnValue({
      data: {
        user: { id: 'usr-cleanup', email: 'c@y.com', user_metadata: {} },
        session: { access_token: 'at', refresh_token: 'rt' },
      },
      error: null,
    })
    userUpsertMock.mockResolvedValue({})

    await GET(mkReq({ code: 'ok', next: '/inbox' }))

    expect(cleanupLegacyCookiesMock).toHaveBeenCalledTimes(1)
  })
})
