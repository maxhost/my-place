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
  // Build returns un array de CookieToSet — el handler lo agrega al cookie bag.
  buildLegacyCookieCleanup: (...a: unknown[]) => {
    cleanupLegacyCookiesMock(...a)
    return []
  },
  applyCookies: vi.fn(),
}))

vi.mock('@/db/client', () => ({
  prisma: {
    user: {
      upsert: (...a: unknown[]) => userUpsertMock(...a),
    },
  },
}))

// Mock del accept-core + revalidate: el callback ahora intenta accept inline
// cuando `next` matchéa `/invite/accept/<token>` (T2 — eliminar PÁGINA 2 del
// flow). Importamos via `@/features/members/public.server` (public boundary).
const acceptCoreMock = vi.fn()
const revalidateMemberPermissionsMock = vi.fn()
vi.mock('@/features/members/public.server', () => ({
  acceptInvitationCore: (...a: unknown[]) => acceptCoreMock(...a),
  revalidateMemberPermissions: (...a: unknown[]) => revalidateMemberPermissionsMock(...a),
}))

// Mock cache invalidation (revalidatePath).
const revalidatePathMock = vi.fn()
vi.mock('next/cache', () => ({
  revalidatePath: (...a: unknown[]) => revalidatePathMock(...a),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => Promise<unknown>>(fn: T): T => fn,
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
  acceptCoreMock.mockReset()
  revalidatePathMock.mockReset()
  revalidateMemberPermissionsMock.mockReset()
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

  it('happy path invite + accept inline OK → redirect a placeUrl del slug retornado por core (T2)', async () => {
    verifyOtpMock.mockReturnValue({
      data: {
        user: { id: 'usr-1', email: 'ana@example.com', user_metadata: {} },
        session: { access_token: 'at', refresh_token: 'rt' },
      },
      error: null,
    })
    userUpsertMock.mockResolvedValue({})
    acceptCoreMock.mockResolvedValue({
      ok: true,
      placeSlug: 'the-company',
      placeId: 'place-1',
      alreadyMember: false,
    })

    const res = await GET(
      mkReq({
        token_hash: 'hash_invite_xyz',
        type: 'invite',
        next: '/invite/accept/tok_abc',
      }),
    )

    expect(res.status).toBe(200)
    // T2: el callback acepta inline y redirige DIRECTO al place subdomain
    // (no más PÁGINA 2 con botón "Aceptar y entrar").
    expect(await res.text()).toContain('http://the-company.localhost:3000/')
    expect(verifyOtpMock).toHaveBeenCalledWith({
      token_hash: 'hash_invite_xyz',
      type: 'invite',
    })
    expect(userUpsertMock).toHaveBeenCalledTimes(1)
    expect(acceptCoreMock).toHaveBeenCalledWith('tok_abc', 'usr-1')
    expect(revalidatePathMock).toHaveBeenCalledWith('/inbox')
    expect(revalidatePathMock).toHaveBeenCalledWith('/the-company')
    expect(revalidatePathMock).toHaveBeenCalledWith('/the-company', 'layout')
    expect(revalidateMemberPermissionsMock).toHaveBeenCalledWith('usr-1', 'place-1')

    // verifyOtp escribió cookies vía setAll del adapter.
    expect(setAllSpy).toHaveBeenCalledTimes(1)
  })

  it('accept inline FAILS (e.g. expired) → fallback a accept page con ?error=expired (T2)', async () => {
    verifyOtpMock.mockReturnValue({
      data: {
        user: { id: 'usr-1', email: 'ana@example.com', user_metadata: {} },
        session: { access_token: 'at', refresh_token: 'rt' },
      },
      error: null,
    })
    userUpsertMock.mockResolvedValue({})
    // Simular que el core tira ValidationError con reason=expired (igual que
    // el código real de `acceptInvitationCore`).
    const expiredErr = Object.assign(new Error('La invitación expiró.'), {
      code: 'VALIDATION',
      context: { reason: 'expired' },
      name: 'ValidationError',
    })
    // isDomainError check matcha por instanceof DomainError. Mockeamos shape.
    acceptCoreMock.mockRejectedValue(expiredErr)

    const res = await GET(
      mkReq({
        token_hash: 'h',
        type: 'invite',
        next: '/invite/accept/tok_expired',
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.text()
    // Fallback redirect: vuelve a la accept page con error param para que la
    // page renderee el mensaje (o `<InvitationProblem kind="expired">`).
    expect(body).toContain('http://localhost:3000/invite/accept/tok_expired')
    expect(body).toContain('error=')
    expect(acceptCoreMock).toHaveBeenCalledWith('tok_expired', 'usr-1')
    // Cache invalidation NO se llama si el accept falló.
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it('next NO es /invite/accept/<tok> → resolveNextRedirect (no llama acceptCore)', async () => {
    verifyOtpMock.mockReturnValue({
      data: {
        user: { id: 'usr-1', email: 'a@y.com', user_metadata: {} },
        session: { access_token: 'at', refresh_token: 'rt' },
      },
      error: null,
    })
    userUpsertMock.mockResolvedValue({})

    const res = await GET(
      mkReq({
        token_hash: 'h',
        type: 'magiclink',
        next: '/inbox',
      }),
    )

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('http://app.localhost:3000/')
    // Sin token de invitación, accept inline NO se ejecuta.
    expect(acceptCoreMock).not.toHaveBeenCalled()
  })

  it('happy path magiclink + accept inline (T2 también aplica al type=magiclink)', async () => {
    verifyOtpMock.mockReturnValue({
      data: {
        user: { id: 'usr-2', email: 'bob@example.com', user_metadata: {} },
        session: { access_token: 'at', refresh_token: 'rt' },
      },
      error: null,
    })
    userUpsertMock.mockResolvedValue({})
    acceptCoreMock.mockResolvedValue({
      ok: true,
      placeSlug: 'the-company',
      placeId: 'place-1',
      alreadyMember: false,
    })

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
    expect(acceptCoreMock).toHaveBeenCalledWith('tok_xyz', 'usr-2')
  })

  it('next /<slug>/conversations → place subdomain (host-aware, no es invite path)', async () => {
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
    // Path no es invitación → no llama acceptCore.
    expect(acceptCoreMock).not.toHaveBeenCalled()
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
