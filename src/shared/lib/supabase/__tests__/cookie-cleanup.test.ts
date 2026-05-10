import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/shared/config/env', () => ({
  clientEnv: { NEXT_PUBLIC_APP_DOMAIN: 'place.community' },
}))

import { cleanupLegacyCookies } from '../cookie-cleanup'

type CookieRecord = { name: string; value: string }
type SetCall = {
  name: string
  value: string
  options: { domain?: string; maxAge?: number; path?: string }
}

function fakeReq(cookies: CookieRecord[]): Parameters<typeof cleanupLegacyCookies>[0] {
  return {
    cookies: {
      getAll: () => cookies,
    },
  } as Parameters<typeof cleanupLegacyCookies>[0]
}

function fakeResponse() {
  const calls: SetCall[] = []
  const response = {
    cookies: {
      set: (name: string, value: string, options: SetCall['options']) => {
        calls.push({ name, value, options })
      },
    },
  } as unknown as Parameters<typeof cleanupLegacyCookies>[1]
  return { response, calls }
}

describe('cleanupLegacyCookies', () => {
  let calls: SetCall[]
  let response: Parameters<typeof cleanupLegacyCookies>[1]

  beforeEach(() => {
    const fr = fakeResponse()
    response = fr.response
    calls = fr.calls
  })

  it('sin cookies sb-* en el request → no emite Set-Cookie', () => {
    cleanupLegacyCookies(fakeReq([{ name: 'other', value: 'foo' }]), response)
    expect(calls).toHaveLength(0)
  })

  it('cookie sb-tkidot-auth-token → cleanup en 3 variantes (apex, app.<apex>, host-only)', () => {
    cleanupLegacyCookies(fakeReq([{ name: 'sb-tkidot-auth-token', value: 'whatever' }]), response)

    // 3 cleanups: Domain=place.community + Domain=app.place.community + host-only.
    expect(calls).toHaveLength(3)

    const apexCleanup = calls.find((c) => c.options.domain === 'place.community')
    expect(apexCleanup).toBeDefined()
    expect(apexCleanup?.value).toBe('')
    expect(apexCleanup?.options.maxAge).toBe(0)

    const subdomainCleanup = calls.find((c) => c.options.domain === 'app.place.community')
    expect(subdomainCleanup).toBeDefined()

    const hostOnly = calls.find((c) => c.options.domain === undefined)
    expect(hostOnly).toBeDefined()
    expect(hostOnly?.options.maxAge).toBe(0)
  })

  it('chunked cookies (auth-token.0, .1) → cubre todas con 3 variantes c/u', () => {
    cleanupLegacyCookies(
      fakeReq([
        { name: 'sb-tkidot-auth-token.0', value: 'chunk-a' },
        { name: 'sb-tkidot-auth-token.1', value: 'chunk-b' },
      ]),
      response,
    )
    // 2 cookies × 3 variantes = 6 cleanups.
    expect(calls).toHaveLength(6)

    const cleanedNames = new Set(calls.map((c) => c.name))
    expect(cleanedNames).toEqual(new Set(['sb-tkidot-auth-token.0', 'sb-tkidot-auth-token.1']))
  })

  it('code-verifier residual de PKCE → cubierto', () => {
    cleanupLegacyCookies(
      fakeReq([{ name: 'sb-tkidot-auth-token-code-verifier', value: 'cv' }]),
      response,
    )
    expect(calls).toHaveLength(3)
    expect(calls.every((c) => c.name === 'sb-tkidot-auth-token-code-verifier')).toBe(true)
  })

  it('cookies de DOS proyectos Supabase distintos (proyecto viejo + actual) → ambos limpiados', () => {
    cleanupLegacyCookies(
      fakeReq([
        { name: 'sb-tkidotchffveygzisxbn-auth-token', value: 'current' },
        { name: 'sb-pdifweaajellxzdpbaht-auth-token', value: 'legacy-project' },
      ]),
      response,
    )
    // 2 cookies × 3 variantes = 6 cleanups.
    expect(calls).toHaveLength(6)
    const names = new Set(calls.map((c) => c.name))
    expect(names).toEqual(
      new Set(['sb-tkidotchffveygzisxbn-auth-token', 'sb-pdifweaajellxzdpbaht-auth-token']),
    )
  })

  it('ignora cookies que no matchean pattern sb-*-auth-token', () => {
    cleanupLegacyCookies(
      fakeReq([
        { name: 'sb-tkidot-auth-token', value: 'real' },
        { name: 'sb-something-else', value: 'unrelated' },
        { name: 'sb-no-suffix', value: 'unrelated' },
        { name: 'random', value: 'r' },
      ]),
      response,
    )
    // Solo sb-tkidot-auth-token cuenta → 3 cleanups.
    expect(calls).toHaveLength(3)
    expect(calls.every((c) => c.name === 'sb-tkidot-auth-token')).toBe(true)
  })

  it('semántica idempotente documentada: invocar dos veces NO filtra', () => {
    // La función no trackea estado. El caller invoca una vez por request.
    const req = fakeReq([{ name: 'sb-tkidot-auth-token', value: 'x' }])
    cleanupLegacyCookies(req, response)
    cleanupLegacyCookies(req, response)
    expect(calls).toHaveLength(6)
  })
})
