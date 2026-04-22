import { describe, it, expect } from 'vitest'
import { buildInboxUrl, deriveDisplayName, resolveSafeNext } from './helpers'

const APP_URL = 'http://localhost:3000'
const APP_DOMAIN = 'localhost:3000'

describe('resolveSafeNext', () => {
  it('devuelve el inbox cuando no hay next', () => {
    expect(resolveSafeNext(null, APP_URL, APP_DOMAIN)).toBe('http://app.localhost:3000/')
    expect(resolveSafeNext('', APP_URL, APP_DOMAIN)).toBe('http://app.localhost:3000/')
  })

  it('acepta un path relativo dentro de la app', () => {
    expect(resolveSafeNext('/inbox', APP_URL, APP_DOMAIN)).toBe('http://localhost:3000/inbox')
  })

  it('acepta un subdominio del apex', () => {
    const out = resolveSafeNext('http://thecompany.localhost:3000/threads', APP_URL, APP_DOMAIN)
    expect(out).toBe('http://thecompany.localhost:3000/threads')
  })

  it('rechaza hosts externos (prevención open-redirect)', () => {
    expect(resolveSafeNext('http://evil.com/steal', APP_URL, APP_DOMAIN)).toBe(
      'http://app.localhost:3000/',
    )
  })

  it('rechaza protocol-relative URLs que apunten afuera', () => {
    expect(resolveSafeNext('//evil.com/steal', APP_URL, APP_DOMAIN)).toBe(
      'http://app.localhost:3000/',
    )
  })

  it('no confunde dominios que parezcan subdominios (prefijo)', () => {
    expect(resolveSafeNext('http://notlocalhost:3000/x', APP_URL, APP_DOMAIN)).toBe(
      'http://app.localhost:3000/',
    )
  })
})

describe('buildInboxUrl', () => {
  it('usa https fuera del entorno local', () => {
    expect(buildInboxUrl('place.app')).toBe('https://app.place.app/')
  })

  it('usa http en lvh.me (dev)', () => {
    expect(buildInboxUrl('lvh.me:3000')).toBe('http://app.lvh.me:3000/')
  })

  it('usa http en localhost (dev legacy)', () => {
    expect(buildInboxUrl('localhost:3000')).toBe('http://app.localhost:3000/')
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
