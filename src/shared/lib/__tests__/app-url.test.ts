import { describe, expect, it, vi } from 'vitest'

// Mockeamos `clientEnv` antes de importar el SUT. El default usado por la
// mayoría de los casos es `place.community` (dominio de prod), que fuerza
// `https`. El caso aislado de `lvh.me:3000` muta el binding hoisteado para
// verificar que `protocolFor` decide bien http vs https.
const mockEnv = vi.hoisted(() => ({
  current: { NEXT_PUBLIC_APP_DOMAIN: 'place.community' },
}))

vi.mock('@/shared/config/env', () => ({
  get clientEnv() {
    return mockEnv.current
  },
}))

import { apexUrl, assertValidSlug, inboxUrl, placeUrl } from '../app-url'

describe('inboxUrl', () => {
  it('retorna la URL del inbox sin path', () => {
    expect(inboxUrl().toString()).toBe('https://app.place.community/')
  })

  it('respeta el path opcional', () => {
    expect(inboxUrl('/foo').toString()).toBe('https://app.place.community/foo')
  })
})

describe('placeUrl', () => {
  it('retorna el subdominio del place sin path', () => {
    expect(placeUrl('the-company').toString()).toBe('https://the-company.place.community/')
  })

  it('respeta el path opcional', () => {
    expect(placeUrl('the-company', '/conversations').toString()).toBe(
      'https://the-company.place.community/conversations',
    )
  })

  it('rechaza slug con whitespace al final (vector del bug %20)', () => {
    expect(() => placeUrl('the-company ')).toThrow(/slug inválido/)
  })

  it('rechaza slug con whitespace interno', () => {
    expect(() => placeUrl('the company')).toThrow(/slug inválido/)
  })

  it('rechaza slug con uppercase', () => {
    expect(() => placeUrl('THE-COMPANY')).toThrow(/slug inválido/)
  })

  it('rechaza slug con slash', () => {
    expect(() => placeUrl('a/b')).toThrow(/slug inválido/)
  })
})

describe('apexUrl', () => {
  it('en prod prefija www.<apex> (evita redirect Vercel apex→www que rompe cookies en Safari iOS)', () => {
    expect(apexUrl().toString()).toBe('https://www.place.community/')
  })

  it('en prod con path agrega path al www.<apex>', () => {
    expect(apexUrl('/login').toString()).toBe('https://www.place.community/login')
  })

  it('en local (lvh.me) NO prefija www. (no existe ese alias en dev)', () => {
    const original = mockEnv.current.NEXT_PUBLIC_APP_DOMAIN
    mockEnv.current.NEXT_PUBLIC_APP_DOMAIN = 'lvh.me:3000'
    try {
      expect(apexUrl('/').toString()).toBe('http://lvh.me:3000/')
    } finally {
      mockEnv.current.NEXT_PUBLIC_APP_DOMAIN = original
    }
  })
})

describe('assertValidSlug', () => {
  it('acepta slugs válidos lower-case alfanuméricos con guiones', () => {
    expect(() => assertValidSlug('the-company')).not.toThrow()
    expect(() => assertValidSlug('place-42')).not.toThrow()
    expect(() => assertValidSlug('a')).not.toThrow()
  })

  it('rechaza string vacío', () => {
    expect(() => assertValidSlug('')).toThrow(/slug inválido/)
  })
})

describe('placeUrl con dominio local (lvh.me:3000)', () => {
  it('usa http en vez de https para hosts locales', () => {
    // Mutamos el binding hoisteado para este caso aislado, así el mock de
    // prod no contamina y `protocolFor` decide bien http vs https. Restauramos
    // al final para no afectar el orden de tests siguientes.
    const prev = mockEnv.current
    mockEnv.current = { NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000' }
    try {
      expect(placeUrl('demo').toString()).toBe('http://demo.lvh.me:3000/')
    } finally {
      mockEnv.current = prev
    }
  })
})
