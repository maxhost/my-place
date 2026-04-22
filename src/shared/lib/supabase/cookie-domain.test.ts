import { describe, it, expect } from 'vitest'
import { cookieDomain } from './cookie-domain'

describe('cookieDomain', () => {
  it('strip del puerto', () => {
    expect(cookieDomain('localhost:3000')).toBe('localhost')
    expect(cookieDomain('place.app:443')).toBe('place.app')
  })

  it('localhost pasa tal cual (browsers lo comparten con *.localhost)', () => {
    expect(cookieDomain('localhost')).toBe('localhost')
  })

  it('IPv4 numérica retorna undefined (browsers rechazan domain sobre IP)', () => {
    expect(cookieDomain('127.0.0.1')).toBeUndefined()
    expect(cookieDomain('10.0.0.5:3000')).toBeUndefined()
  })

  it('FQDN normal se usa tal cual', () => {
    expect(cookieDomain('place.app')).toBe('place.app')
  })

  it('lowercase y trim', () => {
    expect(cookieDomain('  PLACE.APP  ')).toBe('place.app')
  })
})
