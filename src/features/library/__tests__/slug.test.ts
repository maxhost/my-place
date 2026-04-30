import { describe, expect, it } from 'vitest'
import { RESERVED_LIBRARY_CATEGORY_SLUGS, generateLibraryCategorySlug } from '../domain/slug'
import { CategorySlugCollisionError } from '../domain/errors'

describe('generateLibraryCategorySlug', () => {
  it('normaliza acentos y espacios a kebab-case', () => {
    expect(generateLibraryCategorySlug('Recetas Fáciles')).toBe('recetas-faciles')
    expect(generateLibraryCategorySlug('Cómo cocinar')).toBe('como-cocinar')
  })

  it('strippea símbolos no alfanuméricos', () => {
    expect(generateLibraryCategorySlug('Tutoriales (2026!)')).toBe('tutoriales-2026')
  })

  it('strippea emoji', () => {
    expect(generateLibraryCategorySlug('🍳 Recetas')).toBe('recetas')
  })

  it('reserva slugs del producto', () => {
    expect(RESERVED_LIBRARY_CATEGORY_SLUGS.has('new')).toBe(true)
    expect(generateLibraryCategorySlug('New')).toBe('new-2')
  })

  it('respeta reserved set custom (slugs ya tomados en el place)', () => {
    const reserved = new Set([...RESERVED_LIBRARY_CATEGORY_SLUGS, 'recetas'])
    expect(generateLibraryCategorySlug('Recetas', { reserved })).toBe('recetas-2')
  })

  it('encadena sufijos cuando hay múltiples colisiones', () => {
    const reserved = new Set([
      ...RESERVED_LIBRARY_CATEGORY_SLUGS,
      'recetas',
      'recetas-2',
      'recetas-3',
    ])
    expect(generateLibraryCategorySlug('Recetas', { reserved })).toBe('recetas-4')
  })

  it('usa fallback cuando el título normaliza a vacío', () => {
    expect(generateLibraryCategorySlug('???')).toBe('categoria')
    expect(generateLibraryCategorySlug('???', { fallback: 'mio' })).toBe('mio')
  })

  it('lanza CategorySlugCollisionError si agota los sufijos', () => {
    const reserved = new Set<string>(['x'])
    for (let n = 2; n < 1000; n++) reserved.add(`x-${n}`)
    expect(() => generateLibraryCategorySlug('x', { reserved })).toThrow(CategorySlugCollisionError)
  })

  it('trunca al límite de 80 chars sin cortar palabras al medio cuando posible', () => {
    const long = 'x'.repeat(60) + ' ' + 'y'.repeat(30)
    const slug = generateLibraryCategorySlug(long)
    expect(slug.length).toBeLessThanOrEqual(80)
    expect(slug.endsWith('-')).toBe(false)
  })
})
