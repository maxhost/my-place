import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock de clientEnv para tener apex estable. `app-url.ts` lee
// `NEXT_PUBLIC_APP_DOMAIN` para construir URLs absolutas.
vi.mock('@/shared/config/env', () => ({
  clientEnv: {
    NEXT_PUBLIC_APP_DOMAIN: 'place.community',
    NEXT_PUBLIC_APP_URL: 'https://place.community',
  },
}))

// Spy en logger para verificar warns defensivos sin ensuciar stdout.
vi.mock('@/shared/lib/logger', () => {
  const child = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return {
    logger: { child: vi.fn(() => child) },
  }
})

import { logger } from '@/shared/lib/logger'
import { resolveNextRedirect } from '../next-redirect'

function getChildLogger() {
  return (logger.child as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
    warn: ReturnType<typeof vi.fn>
  }
}

describe('resolveNextRedirect — fallback', () => {
  beforeEach(() => {
    getChildLogger()?.warn.mockClear()
  })

  it('null → inbox subdomain root', () => {
    expect(resolveNextRedirect(null).toString()).toBe('https://app.place.community/')
  })

  it('empty string → inbox subdomain root', () => {
    expect(resolveNextRedirect('').toString()).toBe('https://app.place.community/')
  })
})

describe('resolveNextRedirect — paths globales (apex)', () => {
  beforeEach(() => {
    getChildLogger()?.warn.mockClear()
  })

  it('/invite/accept/<token> → www.<apex> (apex via apexUrl, prefijado www en prod)', () => {
    const token = 'aBcDeF0123456789-_xyzABCDEF0123456789-_xyz0'
    const url = resolveNextRedirect(`/invite/accept/${token}`)
    expect(url.toString()).toBe(`https://www.place.community/invite/accept/${token}`)
  })

  it('/login → www.<apex>', () => {
    expect(resolveNextRedirect('/login').toString()).toBe('https://www.place.community/login')
  })

  it('/auth/callback → www.<apex> (edge: bouncing intencional)', () => {
    expect(resolveNextRedirect('/auth/callback').toString()).toBe(
      'https://www.place.community/auth/callback',
    )
  })
})

describe('resolveNextRedirect — paths del subdomain inbox', () => {
  beforeEach(() => {
    getChildLogger()?.warn.mockClear()
  })

  it('/inbox → inbox subdomain root (NO /inbox literal — el middleware lo reescribiría a /inbox/inbox que no existe)', () => {
    // El middleware caso 'inbox' hace `pathname = '/inbox' + rest`. Si rest
    // es '/inbox', resulta '/inbox/inbox' → 404. Por eso `/inbox` se mapea
    // al root del subdomain (`app.<apex>/`), donde rest = '' → pathname `/inbox` → existe.
    expect(resolveNextRedirect('/inbox').toString()).toBe('https://app.place.community/')
  })

  it('/inbox/places/new → inbox subdomain con subpath sin doblar prefijo', () => {
    expect(resolveNextRedirect('/inbox/places/new').toString()).toBe(
      'https://app.place.community/places/new',
    )
  })
})

describe('resolveNextRedirect — paths del subdomain place', () => {
  beforeEach(() => {
    getChildLogger()?.warn.mockClear()
  })

  it('/{slug}/conversations → {slug} subdomain root + /conversations', () => {
    const url = resolveNextRedirect('/the-company/conversations')
    expect(url.toString()).toBe('https://the-company.place.community/conversations')
  })

  it('/{slug}/library/<sub> → place subdomain', () => {
    const url = resolveNextRedirect('/the-company/library/abc')
    expect(url.toString()).toBe('https://the-company.place.community/library/abc')
  })

  it('/{slug}/events → place subdomain', () => {
    expect(resolveNextRedirect('/the-company/events').toString()).toBe(
      'https://the-company.place.community/events',
    )
  })

  it('/{slug}/m/<userId> → place subdomain', () => {
    expect(resolveNextRedirect('/the-company/m/usr-123').toString()).toBe(
      'https://the-company.place.community/m/usr-123',
    )
  })

  it('/{slug}/settings y subpaths → place subdomain', () => {
    expect(resolveNextRedirect('/the-company/settings').toString()).toBe(
      'https://the-company.place.community/settings',
    )
    expect(resolveNextRedirect('/the-company/settings/access').toString()).toBe(
      'https://the-company.place.community/settings/access',
    )
  })
})

describe('resolveNextRedirect — defensa contra paths inválidos', () => {
  beforeEach(() => {
    getChildLogger()?.warn.mockClear()
  })

  it('/{slug}/<unknown-section> → fallback inbox (no en SAFE_NEXT_PATTERNS)', () => {
    const url = resolveNextRedirect('/the-company/admin')
    expect(url.toString()).toBe('https://app.place.community/')
    expect(getChildLogger().warn).toHaveBeenCalledWith(
      expect.objectContaining({ rawNext: '/the-company/admin' }),
      'next_redirect_unknown_path',
    )
  })

  it('/not-found → fallback inbox', () => {
    expect(resolveNextRedirect('/not-found').toString()).toBe('https://app.place.community/')
  })

  it('/foo/bar/baz → fallback inbox', () => {
    expect(resolveNextRedirect('/foo/bar/baz').toString()).toBe('https://app.place.community/')
  })

  it('path traversal /inbox/../etc → normalizado y rechazado', () => {
    // `new URL('/inbox/../etc', base)` resuelve a `/etc`. /etc no matchea
    // ningún pattern → fallback.
    const url = resolveNextRedirect('/inbox/../etc')
    expect(url.toString()).toBe('https://app.place.community/')
  })

  it('/invite/accept/<malformed con espacio> → fallback', () => {
    const url = resolveNextRedirect('/invite/accept/has space')
    expect(url.toString()).toBe('https://app.place.community/')
  })

  it('/invite/accept/<token>/extra → fallback (path con suffix extra)', () => {
    const url = resolveNextRedirect('/invite/accept/sometoken/extra')
    expect(url.toString()).toBe('https://app.place.community/')
  })

  it('slug con whitespace → fallback (assertValidSlug rechaza)', () => {
    const url = resolveNextRedirect('/the company/conversations')
    expect(url.toString()).toBe('https://app.place.community/')
  })
})

describe('resolveNextRedirect — URL absoluta', () => {
  beforeEach(() => {
    getChildLogger()?.warn.mockClear()
  })

  it('URL absoluta same-host (apex) con path en allowlist → aceptada', () => {
    const url = resolveNextRedirect('https://place.community/invite/accept/tok123-_AB')
    expect(url.toString()).toBe('https://place.community/invite/accept/tok123-_AB')
  })

  it('URL absoluta de subdomain place válido + path conocido → aceptada', () => {
    const url = resolveNextRedirect('https://the-company.place.community/conversations')
    expect(url.toString()).toBe('https://the-company.place.community/conversations')
  })

  it('URL absoluta de subdomain inbox + path conocido → aceptada', () => {
    const url = resolveNextRedirect('https://app.place.community/places/new')
    expect(url.toString()).toBe('https://app.place.community/places/new')
  })

  it('URL absoluta cross-origin (evil.com) → fallback con warn', () => {
    const url = resolveNextRedirect('https://evil.com/path')
    expect(url.toString()).toBe('https://app.place.community/')
    expect(getChildLogger().warn).toHaveBeenCalledWith(
      expect.objectContaining({ rawNext: 'https://evil.com/path' }),
      'next_redirect_cross_origin',
    )
  })

  it('protocol-relative //evil.com/x → fallback', () => {
    const url = resolveNextRedirect('//evil.com/x')
    expect(url.toString()).toBe('https://app.place.community/')
  })

  it('URL malformada (http://[invalid) → fallback con warn', () => {
    const url = resolveNextRedirect('http://[invalid')
    expect(url.toString()).toBe('https://app.place.community/')
    expect(getChildLogger().warn).toHaveBeenCalledWith(
      expect.objectContaining({ rawNext: 'http://[invalid' }),
      'next_redirect_invalid_url',
    )
  })
})
