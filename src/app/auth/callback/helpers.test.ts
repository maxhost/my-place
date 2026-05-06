import { describe, it, expect, vi, beforeEach } from 'vitest'

// `helpers.ts` importa `inboxUrl` desde `@/shared/lib/app-url`, que a su vez
// importa `clientEnv` al top-level. Mockeamos para evitar el parse eager del
// env real durante los tests (Zod tiraría sin `NEXT_PUBLIC_*` definidos).
vi.mock('@/shared/config/env', () => ({
  clientEnv: { NEXT_PUBLIC_APP_DOMAIN: 'localhost:3000' },
}))

// Spy en el logger para verificar los warns defensivos sin ensuciar stdout.
vi.mock('@/shared/lib/logger', () => {
  const child = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }
  return {
    logger: { child: vi.fn(() => child) },
  }
})

import { logger } from '@/shared/lib/logger'
import { buildInboxUrl, deriveDisplayName, resolveSafeNext } from './helpers'

const FALLBACK = new URL('http://app.localhost:3000/')

// Helper para acceder al spy del child logger (mock devuelve siempre el mismo).
function getChildLogger() {
  return (logger.child as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
    warn: ReturnType<typeof vi.fn>
  }
}

describe('resolveSafeNext', () => {
  beforeEach(() => {
    getChildLogger()?.warn.mockClear()
  })

  it('devuelve el fallback cuando no hay next', () => {
    expect(resolveSafeNext(null, FALLBACK).toString()).toBe('http://app.localhost:3000/')
    expect(resolveSafeNext('', FALLBACK).toString()).toBe('http://app.localhost:3000/')
  })

  it('acepta /inbox (allowlist)', () => {
    const out = resolveSafeNext('/inbox', FALLBACK)
    expect(out.pathname).toBe('/inbox')
  })

  it('acepta sub-paths de /inbox (ej: /inbox/places/new)', () => {
    const out = resolveSafeNext('/inbox/places/new', FALLBACK)
    expect(out.pathname).toBe('/inbox/places/new')
  })

  it('acepta /{slug}/conversations (subpath de place conocido)', () => {
    const out = resolveSafeNext('/the-company/conversations', FALLBACK)
    expect(out.pathname).toBe('/the-company/conversations')
  })

  it('acepta /{slug}/m/{userId}', () => {
    const out = resolveSafeNext('/the-company/m/usr-123', FALLBACK)
    expect(out.pathname).toBe('/the-company/m/usr-123')
  })

  it('acepta /{slug}/settings y subpaths', () => {
    expect(resolveSafeNext('/the-company/settings', FALLBACK).pathname).toBe(
      '/the-company/settings',
    )
    expect(resolveSafeNext('/the-company/settings/members', FALLBACK).pathname).toBe(
      '/the-company/settings/members',
    )
  })

  it('acepta /login y /auth/callback (edge: re-login y bouncing)', () => {
    expect(resolveSafeNext('/login', FALLBACK).pathname).toBe('/login')
    expect(resolveSafeNext('/auth/callback', FALLBACK).pathname).toBe('/auth/callback')
  })

  it('rechaza /not-found (path conocido que rendea 404) y loguea warn', () => {
    const out = resolveSafeNext('/not-found', FALLBACK)
    expect(out.toString()).toBe(FALLBACK.toString())
    expect(getChildLogger().warn).toHaveBeenCalledWith(
      expect.objectContaining({ rawNext: '/not-found', pathname: '/not-found' }),
      'callback_unsafe_next_unknown_path',
    )
  })

  it('rechaza cross-origin (https://evil.com/x) y loguea warn', () => {
    const out = resolveSafeNext('https://evil.com/x', FALLBACK)
    expect(out.toString()).toBe(FALLBACK.toString())
    expect(getChildLogger().warn).toHaveBeenCalledWith(
      expect.objectContaining({ rawNext: 'https://evil.com/x' }),
      'callback_unsafe_next_cross_origin',
    )
  })

  it('rechaza protocol-relative (//evil.com/x) que apunte afuera', () => {
    const out = resolveSafeNext('//evil.com/x', FALLBACK)
    expect(out.toString()).toBe(FALLBACK.toString())
  })

  it('normaliza path con .. y rechaza si el resultado no matchea allowlist', () => {
    // `new URL('/inbox/../etc', base)` resuelve a `/etc` — pathname normalizado.
    const out = resolveSafeNext('/inbox/../etc', FALLBACK)
    expect(out.toString()).toBe(FALLBACK.toString())
    expect(getChildLogger().warn).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/etc' }),
      'callback_unsafe_next_unknown_path',
    )
  })

  it('rechaza paths random unknown (/admin sin subpath de place válido)', () => {
    // `/admin` matchea `[a-z0-9-]+` pero NO tiene subpath conocido.
    // El allowlist de slug exige subpath conocido para evitar falsos positivos
    // como `/not-found`, `/admin`, etc.
    const out = resolveSafeNext('/admin', FALLBACK)
    expect(out.toString()).toBe(FALLBACK.toString())
  })

  it('rechaza paths totalmente desconocidos (/foo/bar/baz)', () => {
    const out = resolveSafeNext('/foo/bar/baz', FALLBACK)
    expect(out.toString()).toBe(FALLBACK.toString())
  })

  it('rechaza URL malformada y loguea warn', () => {
    // `http://[invalid` falla en el constructor de URL.
    const out = resolveSafeNext('http://[invalid', FALLBACK)
    expect(out.toString()).toBe(FALLBACK.toString())
    expect(getChildLogger().warn).toHaveBeenCalledWith(
      expect.objectContaining({ rawNext: 'http://[invalid' }),
      'callback_unsafe_next_invalid_url',
    )
  })

  it('acepta URL absoluta same-origin que matchee allowlist', () => {
    const fallback = new URL('http://app.localhost:3000/')
    const out = resolveSafeNext('http://app.localhost:3000/inbox', fallback)
    expect(out.toString()).toBe('http://app.localhost:3000/inbox')
  })
})

describe('buildInboxUrl', () => {
  it('retorna URL al inbox del apex configurado en clientEnv', () => {
    // `clientEnv.NEXT_PUBLIC_APP_DOMAIN` está mockeado a `localhost:3000`,
    // así que el helper resuelve a `http://app.localhost:3000/`.
    expect(buildInboxUrl().toString()).toBe('http://app.localhost:3000/')
  })

  it('retorna instancia URL (no string) — los consumers usan .toString() o .pathname', () => {
    expect(buildInboxUrl()).toBeInstanceOf(URL)
  })
})

describe('deriveDisplayName', () => {
  it('prefiere full_name del metadata', () => {
    expect(deriveDisplayName('a@b.com', { full_name: '  Ana ' })).toBe('Ana')
  })

  it('cae a la parte local del email si no hay full_name', () => {
    expect(deriveDisplayName('ana@example.com', {})).toBe('ana')
    expect(deriveDisplayName('ana@example.com', undefined)).toBe('ana')
  })

  it('cae a "Miembro" si no hay email ni metadata útil', () => {
    expect(deriveDisplayName(null, {})).toBe('Miembro')
    expect(deriveDisplayName(null, { full_name: 42 })).toBe('Miembro')
  })
})
