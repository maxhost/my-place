import { describe, expect, it } from 'vitest'
import {
  AuthorizationError,
  ConflictError,
  DomainError,
  InvariantViolation,
  InvitationEmailFailedError,
  InvitationLinkGenerationError,
  NotFoundError,
  OutOfHoursError,
  ValidationError,
  isDomainError,
} from './domain-error'

describe('DomainError subclasses', () => {
  it('cada subclase expone su code correcto', () => {
    expect(new InvariantViolation('x').code).toBe('INVARIANT_VIOLATION')
    expect(new AuthorizationError('x').code).toBe('AUTHORIZATION')
    expect(new NotFoundError('x').code).toBe('NOT_FOUND')
    expect(new ValidationError('x').code).toBe('VALIDATION')
    expect(new ConflictError('x').code).toBe('CONFLICT')
    expect(new OutOfHoursError('x', 'place-1', null).code).toBe('OUT_OF_HOURS')
    expect(new InvitationLinkGenerationError('x').code).toBe('INVITATION_LINK_GENERATION')
    expect(new InvitationEmailFailedError('x').code).toBe('INVITATION_EMAIL_FAILED')
  })

  it('propaga message y context', () => {
    const err = new ConflictError('dup', { reason: 'already_open', placeId: 'p1' })
    expect(err.message).toBe('dup')
    expect(err.context).toEqual({ reason: 'already_open', placeId: 'p1' })
  })

  it('es instance de Error y de DomainError en el server-side', () => {
    const err = new ConflictError('x')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(DomainError)
  })
})

describe('isDomainError', () => {
  it('acepta instancia directa en el server-side', () => {
    expect(isDomainError(new ConflictError('x'))).toBe(true)
    expect(isDomainError(new ValidationError('x'))).toBe(true)
    expect(isDomainError(new InvitationEmailFailedError('x'))).toBe(true)
  })

  it('acepta objeto shape-compatible (simulando boundary cliente)', () => {
    const serialized = { code: 'CONFLICT', message: 'algo' }
    expect(isDomainError(serialized)).toBe(true)
  })

  it('rechaza Error plano', () => {
    expect(isDomainError(new Error('boom'))).toBe(false)
  })

  it('rechaza objetos con code desconocido', () => {
    expect(isDomainError({ code: 'LOL_UNKNOWN', message: 'x' })).toBe(false)
  })

  it('rechaza null, undefined, primitivos', () => {
    expect(isDomainError(null)).toBe(false)
    expect(isDomainError(undefined)).toBe(false)
    expect(isDomainError('string')).toBe(false)
    expect(isDomainError(42)).toBe(false)
  })

  it('rechaza objeto con code no-string', () => {
    expect(isDomainError({ code: 42, message: 'x' })).toBe(false)
  })
})

describe('serialization boundary (server action → client)', () => {
  // El serializador de Next 15 para server actions usa algo equivalente a
  // JSON.parse(JSON.stringify(err)) para transportar errores — pierde la
  // prototype chain. El contract que nos importa: `code` y `message` quedan
  // disponibles como own enumerable props en el objeto del cliente.
  it('el roundtrip JSON preserva code + message', () => {
    const original = new InvitationEmailFailedError('mailer caído', {
      placeId: 'place-1',
      reason: 'resend_down',
    })

    const serialized = JSON.parse(
      JSON.stringify({
        name: original.name,
        message: original.message,
        code: original.code,
        context: original.context,
      }),
    )

    expect(serialized.code).toBe('INVITATION_EMAIL_FAILED')
    expect(serialized.message).toBe('mailer caído')
    expect(serialized.context).toEqual({ placeId: 'place-1', reason: 'resend_down' })

    // Y — el contract crítico — `isDomainError` lo reconoce sin prototype.
    expect(isDomainError(serialized)).toBe(true)
  })

  it('code es own enumerable property (no solo en prototype)', () => {
    const err = new ValidationError('bad', { issues: [] })
    const keys = Object.keys(err)
    expect(keys).toContain('code')

    const descriptor = Object.getOwnPropertyDescriptor(err, 'code')
    expect(descriptor?.enumerable).toBe(true)
    expect(descriptor?.value).toBe('VALIDATION')
  })

  it('Object.assign({}, err) preserva code y message', () => {
    // Aproximación del patrón que usa Next al serializar errores de server actions.
    const err = new ConflictError('dup email', { placeId: 'p1' })
    const plain: Record<string, unknown> = {
      ...Object.fromEntries(Object.entries(err)),
      message: err.message,
    }
    expect(plain.code).toBe('CONFLICT')
    expect(plain.message).toBe('dup email')
    expect(isDomainError(plain)).toBe(true)
  })
})
