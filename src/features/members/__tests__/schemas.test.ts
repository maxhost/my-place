import { describe, it, expect } from 'vitest'
import { inviteMemberSchema } from '../schemas'

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
