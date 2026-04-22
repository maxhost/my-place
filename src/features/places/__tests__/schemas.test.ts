import { describe, it, expect } from 'vitest'
import { createPlaceSchema } from '../schemas'

const base = {
  slug: 'my-place',
  name: 'My Place',
  billingMode: 'OWNER_PAYS' as const,
}

describe('createPlaceSchema', () => {
  it('acepta input válido mínimo', () => {
    const res = createPlaceSchema.safeParse(base)
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.description).toBeUndefined()
    }
  })

  it('normaliza description vacía a null', () => {
    const res = createPlaceSchema.safeParse({ ...base, description: '   ' })
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.description).toBeNull()
  })

  it('rechaza name vacío', () => {
    expect(createPlaceSchema.safeParse({ ...base, name: '   ' }).success).toBe(false)
  })

  it('rechaza billingMode desconocido', () => {
    expect(
      createPlaceSchema.safeParse({ ...base, billingMode: 'FREE' as unknown as string }).success,
    ).toBe(false)
  })

  it('rechaza slug inválido', () => {
    expect(createPlaceSchema.safeParse({ ...base, slug: 'A' }).success).toBe(false)
    expect(createPlaceSchema.safeParse({ ...base, slug: '-abc' }).success).toBe(false)
    expect(createPlaceSchema.safeParse({ ...base, slug: 'a--b' }).success).toBe(false)
  })

  it('rechaza description demasiado larga', () => {
    expect(createPlaceSchema.safeParse({ ...base, description: 'x'.repeat(281) }).success).toBe(
      false,
    )
  })
})
