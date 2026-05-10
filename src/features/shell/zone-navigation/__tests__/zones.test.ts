import { describe, expect, it } from 'vitest'
import { ZONES, deriveActiveZone } from '../domain/zones'

describe('ZONES', () => {
  it('contiene 4 zonas (Inicio, Conversaciones, Eventos, Biblioteca) en orden', () => {
    expect(ZONES).toHaveLength(4)
    expect(ZONES[0]?.label).toBe('Inicio')
    expect(ZONES[1]?.label).toBe('Conversaciones')
    expect(ZONES[2]?.label).toBe('Eventos')
    expect(ZONES[3]?.label).toBe('Biblioteca')
  })

  it('cada zona tiene index match con su posición', () => {
    ZONES.forEach((zone, i) => {
      expect(zone.index).toBe(i)
    })
  })

  it('biblioteca tiene path `/library`', () => {
    const lib = ZONES.find((z) => z.label === 'Biblioteca')
    expect(lib?.path).toBe('/library')
  })
})

describe('deriveActiveZone', () => {
  it('"/" devuelve 0 (Inicio)', () => {
    expect(deriveActiveZone('/')).toBe(0)
  })

  it('trailing slash es tolerado: "/conversations/" → 1', () => {
    expect(deriveActiveZone('/conversations/')).toBe(1)
    expect(deriveActiveZone('/events/')).toBe(2)
  })

  it('"/conversations" y sub-paths → 1', () => {
    expect(deriveActiveZone('/conversations')).toBe(1)
    expect(deriveActiveZone('/conversations/some-slug')).toBe(1)
    expect(deriveActiveZone('/conversations/new')).toBe(1)
  })

  it('"/events" y sub-paths → 2', () => {
    expect(deriveActiveZone('/events')).toBe(2)
    expect(deriveActiveZone('/events/abc/edit')).toBe(2)
    expect(deriveActiveZone('/events/new')).toBe(2)
  })

  it('"/library" y sub-paths → 3', () => {
    expect(deriveActiveZone('/library')).toBe(3)
    expect(deriveActiveZone('/library/recetas')).toBe(3)
    expect(deriveActiveZone('/library/')).toBe(3)
  })

  it('paths fuera de zonas devuelven null (settings, m, etc.)', () => {
    expect(deriveActiveZone('/settings')).toBeNull()
    expect(deriveActiveZone('/settings/flags')).toBeNull()
    expect(deriveActiveZone('/m/user-123')).toBeNull()
    expect(deriveActiveZone('/login')).toBeNull()
  })

  it('múltiples trailing slashes normalizan a "/"', () => {
    expect(deriveActiveZone('//')).toBe(0)
    expect(deriveActiveZone('///')).toBe(0)
  })
})
