import { describe, it, expect } from 'vitest'
import { MembershipRole } from '@prisma/client'
import {
  PLACE_MAX_MEMBERS,
  assertInviterHasRole,
  assertPlaceActive,
  assertPlaceHasCapacity,
  generateInvitationToken,
} from '../domain/invariants'
import { AuthorizationError, ConflictError, InvariantViolation } from '@/shared/errors/domain-error'

describe('assertPlaceHasCapacity', () => {
  it('acepta por debajo del límite', () => {
    expect(() => assertPlaceHasCapacity(0)).not.toThrow()
    expect(() => assertPlaceHasCapacity(PLACE_MAX_MEMBERS - 1)).not.toThrow()
  })

  it('rechaza en el límite (150)', () => {
    expect(() => assertPlaceHasCapacity(PLACE_MAX_MEMBERS)).toThrow(InvariantViolation)
  })

  it('rechaza por encima del límite', () => {
    expect(() => assertPlaceHasCapacity(PLACE_MAX_MEMBERS + 1)).toThrow(InvariantViolation)
  })
})

describe('assertInviterHasRole', () => {
  it('acepta owner sin membership', () => {
    expect(() => assertInviterHasRole({ role: null, isOwner: true })).not.toThrow()
  })

  it('acepta owner con membership MEMBER (inusual pero posible)', () => {
    expect(() => assertInviterHasRole({ role: MembershipRole.MEMBER, isOwner: true })).not.toThrow()
  })

  it('acepta ADMIN sin ownership', () => {
    expect(() => assertInviterHasRole({ role: MembershipRole.ADMIN, isOwner: false })).not.toThrow()
  })

  it('rechaza MEMBER simple con AuthorizationError', () => {
    expect(() => assertInviterHasRole({ role: MembershipRole.MEMBER, isOwner: false })).toThrow(
      AuthorizationError,
    )
  })

  it('rechaza ausencia de permisos con AuthorizationError', () => {
    expect(() => assertInviterHasRole({ role: null, isOwner: false })).toThrow(AuthorizationError)
  })
})

describe('assertPlaceActive', () => {
  it('acepta place no archivado', () => {
    expect(() => assertPlaceActive({ archivedAt: null })).not.toThrow()
  })

  it('rechaza place archivado con ConflictError', () => {
    expect(() => assertPlaceActive({ archivedAt: new Date() })).toThrow(ConflictError)
  })
})

describe('generateInvitationToken', () => {
  it('retorna base64url sin padding ni caracteres no-url-safe', () => {
    const token = generateInvitationToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('tiene longitud esperada para 32 bytes (43 chars base64url sin padding)', () => {
    expect(generateInvitationToken()).toHaveLength(43)
  })

  it('genera valores distintos en llamadas sucesivas', () => {
    const a = generateInvitationToken()
    const b = generateInvitationToken()
    expect(a).not.toBe(b)
  })

  it('respeta el parámetro `bytes` si se pasa', () => {
    // 16 bytes → ceil(16/3)*4 - pad = 22 chars base64url sin padding
    expect(generateInvitationToken(16)).toHaveLength(22)
  })
})
