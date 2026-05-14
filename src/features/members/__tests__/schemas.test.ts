import { describe, it, expect } from 'vitest'
import {
  DIRECTORY_LIMIT_DEFAULT,
  DIRECTORY_LIMIT_MAX,
  directoryQueryParamsSchema,
  inviteMemberSchema,
} from '../schemas'

const base = {
  placeSlug: 'the-company',
  email: 'ana@example.com',
}

describe('inviteMemberSchema', () => {
  it('acepta input mínimo y por default `asAdmin=false`', () => {
    const res = inviteMemberSchema.safeParse(base)
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.asAdmin).toBe(false)
      expect(res.data.email).toBe('ana@example.com')
    }
  })

  it('lowercasea y trimea el email', () => {
    const res = inviteMemberSchema.safeParse({ ...base, email: '  ANA@Example.COM  ' })
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.email).toBe('ana@example.com')
  })

  it('rechaza email con formato inválido', () => {
    expect(inviteMemberSchema.safeParse({ ...base, email: 'no-es-email' }).success).toBe(false)
    expect(inviteMemberSchema.safeParse({ ...base, email: '' }).success).toBe(false)
  })

  it('rechaza placeSlug vacío', () => {
    expect(inviteMemberSchema.safeParse({ ...base, placeSlug: '   ' }).success).toBe(false)
  })

  it('respeta `asAdmin=true` cuando se pasa explícitamente', () => {
    const res = inviteMemberSchema.safeParse({ ...base, asAdmin: true })
    expect(res.success).toBe(true)
    if (res.success) expect(res.data.asAdmin).toBe(true)
  })

  it('rechaza email demasiado largo', () => {
    const huge = `${'a'.repeat(250)}@x.io`
    expect(inviteMemberSchema.safeParse({ ...base, email: huge }).success).toBe(false)
  })
})

describe('directoryQueryParamsSchema', () => {
  it('parsea defaults sin input', () => {
    const res = directoryQueryParamsSchema.parse({})
    expect(res.tab).toBe('active')
    expect(res.q).toBe('')
    expect(res.page).toBe(1)
    expect(res.limit).toBe(DIRECTORY_LIMIT_DEFAULT)
  })

  it('coerce de strings (URL params son strings)', () => {
    const res = directoryQueryParamsSchema.parse({ page: '3', limit: '15' })
    expect(res.page).toBe(3)
    expect(res.limit).toBe(15)
  })

  it('rechaza tab inválido', () => {
    expect(directoryQueryParamsSchema.safeParse({ tab: 'foo' }).success).toBe(false)
  })

  it('rechaza page < 1', () => {
    expect(directoryQueryParamsSchema.safeParse({ page: 0 }).success).toBe(false)
    expect(directoryQueryParamsSchema.safeParse({ page: -1 }).success).toBe(false)
  })

  it('rechaza limit fuera de [1, MAX]', () => {
    expect(directoryQueryParamsSchema.safeParse({ limit: 0 }).success).toBe(false)
    expect(directoryQueryParamsSchema.safeParse({ limit: DIRECTORY_LIMIT_MAX + 1 }).success).toBe(
      false,
    )
  })

  it('acepta limit en el borde superior', () => {
    const res = directoryQueryParamsSchema.parse({ limit: DIRECTORY_LIMIT_MAX })
    expect(res.limit).toBe(DIRECTORY_LIMIT_MAX)
  })

  it('rechaza q demasiado largo', () => {
    const huge = 'x'.repeat(101)
    expect(directoryQueryParamsSchema.safeParse({ q: huge }).success).toBe(false)
  })

  it('trimea q', () => {
    const res = directoryQueryParamsSchema.parse({ q: '  ana  ' })
    expect(res.q).toBe('ana')
  })
})
