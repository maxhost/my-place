import { describe, it, expect, vi } from 'vitest'

// Mock del clientEnv. Los helpers ahora construyen URL via `apexUrl()`
// (de `src/shared/lib/app-url.ts`), que lee `NEXT_PUBLIC_APP_DOMAIN` (apex
// SIN protocol). El callback siempre vive en apex — el subdomain del
// `NEXT_PUBLIC_APP_URL` ya no se usa para construir la URL del callback,
// porque romper el apex hace que el redirect post-callback caiga bajo el
// rewrite del middleware caso 'inbox' y termine en 404. Ver ADR
// 2026-05-10-auth-callbacks-on-apex.md.
vi.mock('@/shared/config/env', () => ({
  clientEnv: {
    NEXT_PUBLIC_APP_URL: 'https://app.place.community',
    NEXT_PUBLIC_APP_DOMAIN: 'place.community',
  },
}))

import { authCallbackUrlForNext, inviteCallbackUrl } from '../auth-callback-url'

describe('authCallbackUrlForNext', () => {
  it('construye URL del callback con next URL-encoded (host APEX)', () => {
    const url = authCallbackUrlForNext('/invite/accept/tok_abc123')
    expect(url).toBe(
      'https://www.place.community/auth/callback?next=%2Finvite%2Faccept%2Ftok_abc123',
    )
  })

  it('normaliza nextPath sin slash inicial agregándolo', () => {
    const url = authCallbackUrlForNext('inbox')
    expect(url).toBe('https://www.place.community/auth/callback?next=%2Finbox')
  })

  it('preserva caracteres especiales del path via encodeURIComponent', () => {
    const url = authCallbackUrlForNext('/path/with-dashes_and_underscores/123')
    expect(url).toBe(
      'https://www.place.community/auth/callback?next=%2Fpath%2Fwith-dashes_and_underscores%2F123',
    )
  })

  it('encoding seguro contra injection (query string en el path)', () => {
    const url = authCallbackUrlForNext('/foo?injected=evil')
    expect(url).toBe('https://www.place.community/auth/callback?next=%2Ffoo%3Finjected%3Devil')
    expect(url).not.toContain('&injected=evil')
  })
})

describe('inviteCallbackUrl', () => {
  it('construye URL de /auth/invite-callback con token_hash, type y next (host APEX)', () => {
    const url = inviteCallbackUrl({
      tokenHash: 'hash_abc123',
      type: 'invite',
      next: '/invite/accept/tok_xyz',
    })
    expect(url).toBe(
      'https://www.place.community/auth/invite-callback?token_hash=hash_abc123&type=invite&next=%2Finvite%2Faccept%2Ftok_xyz',
    )
  })

  it('soporta type=magiclink (fallback path para users existentes)', () => {
    const url = inviteCallbackUrl({
      tokenHash: 'hash_abc123',
      type: 'magiclink',
      next: '/invite/accept/tok_xyz',
    })
    expect(url).toContain('type=magiclink')
    expect(url.startsWith('https://www.place.community/')).toBe(true)
  })

  it('normaliza next sin slash inicial agregándolo', () => {
    const url = inviteCallbackUrl({
      tokenHash: 'h',
      type: 'invite',
      next: 'invite/accept/tok',
    })
    expect(url).toContain('next=%2Finvite%2Faccept%2Ftok')
  })

  it('encoding seguro contra injection en next', () => {
    const url = inviteCallbackUrl({
      tokenHash: 'h',
      type: 'invite',
      next: '/foo?evil=1',
    })
    expect(url).toContain('next=%2Ffoo%3Fevil%3D1')
    expect(url).not.toContain('&evil=1')
  })

  it('encoding seguro contra token_hash con caracteres no-url-safe', () => {
    const url = inviteCallbackUrl({
      tokenHash: 'a+b/c=d',
      type: 'invite',
      next: '/inbox',
    })
    expect(url).toContain('token_hash=a%2Bb%2Fc%3Dd')
  })
})
