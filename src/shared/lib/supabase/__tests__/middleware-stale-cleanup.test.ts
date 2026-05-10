import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Tests del cleanup defensivo HOST-ONLY del middleware (commit 6ed1a4c +
 * Sesión 1 hardening). Cubre:
 *   1. getSession lanza stale → emite Set-Cookie maxAge=0 host-only para
 *      `sb-{currentRef}-auth-token` y chunks
 *   2. getSession OK → NO emite cleanup
 *   3. NO toca cookies de OTROS project refs (filtro por currentRef)
 *   4. NO toca cookies no-supabase (`session=`, `_ga=`)
 *   5. Set-Cookie tiene Path=/, Max-Age=0, Secure, SameSite=Lax, SIN Domain
 *   6. Loggea `MW_stale_cleanup` con host, path, currentRef, clearedNames
 *
 * Ver `docs/decisions/2026-05-10-cookie-residual-host-only-cleanup.md`.
 */

const PROJECT_REF = 'tkidotchffveygzisxbn'
const APEX = 'place.community'
const SUBDOMAIN_HOST = `the-company.${APEX}`

const getSessionMock = vi.fn()
const signOutMock = vi.fn().mockResolvedValue({ error: null })
const loggerWarnMock = vi.fn()

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getSession: (...a: unknown[]) => getSessionMock(...a),
      signOut: (...a: unknown[]) => signOutMock(...a),
    },
  }),
}))

// IMPORTANTE: vi.mock se hoistea, por eso los valores van inline (no podemos
// referenciar PROJECT_REF/APEX que se declaran debajo). Mantener sincronizados:
// PROJECT_REF=tkidotchffveygzisxbn, APEX=place.community.
vi.mock('@/shared/config/env', () => ({
  clientEnv: {
    NEXT_PUBLIC_APP_URL: 'https://place.community',
    NEXT_PUBLIC_APP_DOMAIN: 'place.community',
    NEXT_PUBLIC_SUPABASE_URL: 'https://tkidotchffveygzisxbn.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  },
}))

vi.mock('@/shared/lib/logger', () => ({
  logger: {
    warn: (...a: unknown[]) => loggerWarnMock(...a),
    info: vi.fn(),
    error: vi.fn(),
    child: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
  },
}))

import { updateSession } from '../middleware'

function mkReq(cookies: Array<{ name: string; value: string }>): NextRequest {
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  const url = `https://${SUBDOMAIN_HOST}/`
  const req = new NextRequest(url, {
    headers: { cookie: cookieHeader, host: SUBDOMAIN_HOST },
  })
  return req
}

/** Genera un AuthApiError con shape compatible con `isStaleSessionError`. */
function staleErr(code: string, message: string): Error {
  const err = new Error(message)
  Object.assign(err, {
    name: 'AuthApiError',
    code,
    status: 400,
    __isAuthError: true, // algunos checks lo usan; isAuthApiError de @supabase/supabase-js
  })
  return err
}

beforeEach(() => {
  getSessionMock.mockReset()
  signOutMock.mockReset()
  signOutMock.mockResolvedValue({ error: null })
  loggerWarnMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('updateSession — cleanup defensivo HOST-ONLY (Sesión 1)', () => {
  it('happy path (getSession retorna user) → NO emite cleanup', async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          user: { id: 'user-1', email: 'a@b.com' },
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          access_token: 'at',
          refresh_token: 'rt',
        },
      },
    })

    const req = mkReq([
      { name: `sb-${PROJECT_REF}-auth-token`, value: 'base64-eyJ0ZXN0Ijp0cnVlfQ==' },
    ])
    const { response, user } = await updateSession(req)

    expect(user).toEqual({ id: 'user-1', email: 'a@b.com' })
    // Cleanup NO se emite: ningún Set-Cookie con Max-Age=0 para sb-*-auth-token.
    const setCookies = response.headers.getSetCookie?.() ?? []
    const cleanupHeaders = setCookies.filter(
      (h) => /^sb-.*-auth-token/.test(h) && /Max-Age=0/.test(h),
    )
    expect(cleanupHeaders).toHaveLength(0)
    // El log MW_stale_cleanup tampoco se llama.
    const cleanupLogs = loggerWarnMock.mock.calls.filter(
      (c) => (c[0] as { debug?: string })?.debug === 'MW_stale_cleanup',
    )
    expect(cleanupLogs).toHaveLength(0)
  })

  it('refresh_token_not_found → emite Set-Cookie maxAge=0 host-only para sb-{currentRef}-auth-token', async () => {
    getSessionMock.mockRejectedValue(
      staleErr('refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found'),
    )

    const req = mkReq([
      { name: `sb-${PROJECT_REF}-auth-token`, value: 'base64-x' },
      { name: `sb-${PROJECT_REF}-auth-token.0`, value: 'chunk0' },
      { name: `sb-${PROJECT_REF}-auth-token.1`, value: 'chunk1' },
    ])

    const { response, user } = await updateSession(req)

    expect(user).toBeNull()
    const setCookies = response.headers.getSetCookie?.() ?? []
    const cleanupForCurrent = setCookies.filter(
      (h) => h.startsWith(`sb-${PROJECT_REF}-auth-token`) && /Max-Age=0/.test(h),
    )
    // Limpiamos las 3: la base + 2 chunks
    expect(cleanupForCurrent).toHaveLength(3)
    expect(cleanupForCurrent.some((h) => h.startsWith(`sb-${PROJECT_REF}-auth-token=`))).toBe(true)
    expect(cleanupForCurrent.some((h) => h.startsWith(`sb-${PROJECT_REF}-auth-token.0=`))).toBe(
      true,
    )
    expect(cleanupForCurrent.some((h) => h.startsWith(`sb-${PROJECT_REF}-auth-token.1=`))).toBe(
      true,
    )
  })

  it('cleanup NO afecta cookies de OTROS project refs (filtro por currentRef)', async () => {
    getSessionMock.mockRejectedValue(
      staleErr('refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found'),
    )

    const otherRef = 'pdifweaajellxzdpbaht'
    const req = mkReq([
      { name: `sb-${PROJECT_REF}-auth-token`, value: 'base64-x' },
      // Cookie de otro proyecto Supabase coexistente — NO debe tocarse
      { name: `sb-${otherRef}-auth-token`, value: 'base64-other' },
    ])

    const { response } = await updateSession(req)
    const setCookies = response.headers.getSetCookie?.() ?? []
    const cleanupForOther = setCookies.filter((h) => h.startsWith(`sb-${otherRef}-auth-token`))
    expect(cleanupForOther).toHaveLength(0)
  })

  it('cleanup NO afecta cookies no-supabase (session, _ga, etc.)', async () => {
    getSessionMock.mockRejectedValue(
      staleErr('refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found'),
    )

    const req = mkReq([
      { name: `sb-${PROJECT_REF}-auth-token`, value: 'base64-x' },
      { name: 'session', value: 'app-session-id' },
      { name: '_ga', value: 'GA1.1.123' },
      { name: 'analytics_cookie', value: 'foo' },
    ])

    const { response } = await updateSession(req)
    const setCookies = response.headers.getSetCookie?.() ?? []
    const nonSb = setCookies.filter((h) => !h.startsWith('sb-'))
    // No debe haber Set-Cookie maxAge=0 para session/_ga/analytics_cookie
    const nonSbCleanup = nonSb.filter((h) => /Max-Age=0/.test(h))
    expect(nonSbCleanup).toHaveLength(0)
  })

  it('Set-Cookie del cleanup tiene Path=/, Max-Age=0, Secure, SameSite=Lax y SIN Domain', async () => {
    getSessionMock.mockRejectedValue(
      staleErr('refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found'),
    )

    const req = mkReq([{ name: `sb-${PROJECT_REF}-auth-token`, value: 'base64-x' }])
    const { response } = await updateSession(req)
    const setCookies = response.headers.getSetCookie?.() ?? []
    const cleanup = setCookies.find((h) =>
      h.startsWith(`sb-${PROJECT_REF}-auth-token=; Path=/; Max-Age=0`),
    )
    expect(cleanup).toBeDefined()
    expect(cleanup).toMatch(/Path=\//)
    expect(cleanup).toMatch(/Max-Age=0/)
    expect(cleanup).toMatch(/Secure/)
    expect(cleanup).toMatch(/SameSite=Lax/)
    // CRÍTICO: sin Domain (host-only). Si tuviera Domain=apex, no limpiaría
    // la residual host-only que es exactamente el bug que cubrimos.
    expect(cleanup).not.toMatch(/Domain=/)
  })

  it('loggea MW_stale_cleanup con host, path, currentRef, clearedCount, clearedNames', async () => {
    getSessionMock.mockRejectedValue(
      staleErr('refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found'),
    )

    const req = mkReq([
      { name: `sb-${PROJECT_REF}-auth-token`, value: 'base64-x' },
      { name: `sb-${PROJECT_REF}-auth-token.0`, value: 'chunk0' },
    ])
    await updateSession(req)

    const cleanupLog = loggerWarnMock.mock.calls.find(
      (c) => (c[0] as { debug?: string })?.debug === 'MW_stale_cleanup',
    )
    expect(cleanupLog).toBeDefined()
    const meta = cleanupLog?.[0] as {
      host?: string
      path?: string
      currentRef?: string
      clearedCount?: number
      clearedNames?: string[]
    }
    expect(meta.host).toBe(SUBDOMAIN_HOST)
    expect(meta.path).toBe('/')
    expect(meta.currentRef).toBe(PROJECT_REF)
    expect(meta.clearedCount).toBe(2)
    expect(meta.clearedNames).toEqual(
      expect.arrayContaining([`sb-${PROJECT_REF}-auth-token`, `sb-${PROJECT_REF}-auth-token.0`]),
    )
  })
})
