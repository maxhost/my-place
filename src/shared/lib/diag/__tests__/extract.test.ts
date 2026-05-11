import { describe, expect, it } from 'vitest'
import { extractCookieNames, truncateIp, truncateString } from '../extract'

describe('truncateIp', () => {
  it('IPv4 → primeros 3 octetos + .x', () => {
    expect(truncateIp('192.168.1.42')).toBe('192.168.1.x')
  })

  it('X-Forwarded-For chain → solo cliente real (primer entry)', () => {
    expect(truncateIp('203.0.113.7, 10.0.0.1, 10.0.0.2')).toBe('203.0.113.x')
  })

  it('IPv6 → primeros 4 grupos + ::', () => {
    expect(truncateIp('2001:db8:85a3:0:0:8a2e:370:7334')).toBe('2001:db8:85a3:0::')
  })

  it('null/undefined/empty → null (sin throw)', () => {
    expect(truncateIp(null)).toBeNull()
    expect(truncateIp(undefined)).toBeNull()
    expect(truncateIp('')).toBeNull()
  })

  it('input no-IP retorna el string tal cual (best-effort, sin crashear)', () => {
    expect(truncateIp('not-an-ip')).toBe('not-an-ip')
  })
})

describe('extractCookieNames', () => {
  it('default pattern (^sb-) filtra solo cookies de Supabase', () => {
    const cookies = [
      { name: 'sb-abc-auth-token' },
      { name: 'sb-abc-auth-token.0' },
      { name: '_vercel_analytics' },
      { name: 'theme' },
    ]
    expect(extractCookieNames(cookies)).toEqual(['sb-abc-auth-token', 'sb-abc-auth-token.0'])
  })

  it('pattern custom funciona', () => {
    const cookies = [{ name: 'foo' }, { name: 'foo-bar' }, { name: 'baz' }]
    expect(extractCookieNames(cookies, /^foo/)).toEqual(['foo', 'foo-bar'])
  })

  it('lista vacía → []', () => {
    expect(extractCookieNames([])).toEqual([])
  })

  it('NO retorna valores de cookies, solo names (privacidad)', () => {
    // El tipo no permite value, pero verificamos que el output sea solo strings.
    const result = extractCookieNames([{ name: 'sb-x-auth-token' }])
    expect(result.every((n) => typeof n === 'string')).toBe(true)
  })
})

describe('truncateString', () => {
  it('null/undefined → null', () => {
    expect(truncateString(null, 10)).toBeNull()
    expect(truncateString(undefined, 10)).toBeNull()
  })

  it('string corto pasa intacto', () => {
    expect(truncateString('hola', 10)).toBe('hola')
  })

  it('string largo se trunca con ellipsis + length', () => {
    expect(truncateString('abcdefghijklmnop', 5)).toBe('abcde…(16)')
  })
})
