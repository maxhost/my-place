import { describe, expect, it } from 'vitest'
import { RESERVED_POST_SLUGS, generatePostSlug } from '../domain/slug'

describe('generatePostSlug', () => {
  it('normaliza ASCII simple', () => {
    expect(generatePostSlug('Hola mundo')).toBe('hola-mundo')
  })

  it('strippea diacríticos y conserva eñes como n', () => {
    expect(generatePostSlug('Café Ñandú')).toBe('cafe-nandu')
  })

  it('ignora emojis y puntuación', () => {
    expect(generatePostSlug('¿Qué onda? 🎉')).toBe('que-onda')
  })

  it('colapsa secuencias de espacios/símbolos en un solo dash', () => {
    expect(generatePostSlug('  ¿¿ Hola ---  Mundo ??  ')).toBe('hola-mundo')
  })

  it('devuelve fallback "tema" cuando el título es vacío', () => {
    expect(generatePostSlug('')).toBe('tema')
    expect(generatePostSlug('🎉🎉🎉')).toBe('tema')
    expect(generatePostSlug('!!!   ???')).toBe('tema')
  })

  it('respeta fallback custom', () => {
    expect(generatePostSlug('', { fallback: 'post' })).toBe('post')
  })

  it('cuando el slug base cae en RESERVED, agrega sufijo numérico', () => {
    expect(generatePostSlug('Settings')).toBe('settings-2')
    expect(generatePostSlug('Conversations')).toBe('conversations-2')
  })

  it('incrementa el sufijo si el candidato ya está en reserved extendido', () => {
    const reserved = new Set([...RESERVED_POST_SLUGS, 'hola-mundo', 'hola-mundo-2'])
    expect(generatePostSlug('Hola mundo', { reserved })).toBe('hola-mundo-3')
  })

  it('corta a 80 caracteres sin romper la última palabra si el resto es corto', () => {
    const title = 'a'.repeat(70) + ' palabra corta extra'
    const slug = generatePostSlug(title)
    expect(slug.length).toBeLessThanOrEqual(80)
    expect(slug.endsWith('-')).toBe(false)
  })

  it('preserva palabra final cuando entera si entra completa', () => {
    expect(generatePostSlug('uno dos tres cuatro cinco')).toBe('uno-dos-tres-cuatro-cinco')
  })

  it('slug no empieza ni termina con dash', () => {
    const slug = generatePostSlug('--- hola ---')
    expect(slug).toBe('hola')
  })

  it('caso largo real con múltiples palabras, diacríticos y números', () => {
    expect(generatePostSlug('¿Por qué el pub hoy abre a las 9?')).toBe(
      'por-que-el-pub-hoy-abre-a-las-9',
    )
  })

  it('reserved set por default incluye rutas del producto', () => {
    expect(RESERVED_POST_SLUGS.has('settings')).toBe(true)
    expect(RESERVED_POST_SLUGS.has('m')).toBe(true)
    expect(RESERVED_POST_SLUGS.has('conversations')).toBe(true)
    expect(RESERVED_POST_SLUGS.has('flags')).toBe(true)
  })
})
