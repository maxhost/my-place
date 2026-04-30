/**
 * Jerarquía de errores de dominio tipados.
 *
 * Los invariantes de `docs/data-model.md` (max 150 miembros, min 1 owner, slug inmutable,
 * etc.) se expresan como subclases específicas de `InvariantViolation` en cada feature.
 *
 * Uso: nunca lanzar `new Error(...)` desde domain services. Siempre una subclase de DomainError
 * para poder discriminar en logging, mapeo a HTTP, y feedback al usuario.
 *
 * **Nota sobre el boundary de server actions (Next 15):**
 * Cuando un server action tira un error, Next lo serializa a JSON del lado server
 * y lo deserializa en cliente — y en ese roundtrip **se pierde la prototype chain**.
 * Por eso `isDomainError` no usa `instanceof`: chequea la *forma* del objeto
 * (`code` enumerable con valor válido). Los constructores asignan `this.code`
 * explícitamente para garantizar que el campo sea `own enumerable` y sobreviva
 * `JSON.stringify(err)`. Ver `domain-error.serialization.test.ts`.
 */
export const DOMAIN_ERROR_CODES = [
  'INVARIANT_VIOLATION',
  'AUTHORIZATION',
  'NOT_FOUND',
  'VALIDATION',
  'CONFLICT',
  'OUT_OF_HOURS',
  'INVITATION_LINK_GENERATION',
  'INVITATION_EMAIL_FAILED',
  'LIBRARY_CATEGORY_LIMIT_REACHED',
  'LIBRARY_CATEGORY_SLUG_COLLISION',
] as const

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number]

const DOMAIN_ERROR_CODE_SET = new Set<string>(DOMAIN_ERROR_CODES)

export abstract class DomainError extends Error {
  readonly code: DomainErrorCode

  constructor(
    code: DomainErrorCode,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message)
    this.name = this.constructor.name
    // Asignación explícita al field: crea own enumerable property que sobrevive
    // al serializador del boundary de server actions de Next (solo transfiere
    // own props, no valores definidos en prototype).
    this.code = code
  }
}

/** Un invariante del dominio fue violado. Ej: sumar el miembro 151, quedar sin owner. */
export class InvariantViolation extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('INVARIANT_VIOLATION', message, context)
  }
}

/** El actor no tiene permisos para la operación. */
export class AuthorizationError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('AUTHORIZATION', message, context)
  }
}

/** Recurso no encontrado. */
export class NotFoundError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('NOT_FOUND', message, context)
  }
}

/** Input inválido (formato, tipo). Típicamente viene de Zod. */
export class ValidationError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('VALIDATION', message, context)
  }
}

/** Conflicto de concurrencia o estado. Ej: slug duplicado, racing conditions. */
export class ConflictError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('CONFLICT', message, context)
  }
}

/**
 * El place está cerrado (fuera de horario). Lanzado por `assertPlaceOpenOrThrow`
 * al tope de server actions de escritura en conversaciones/eventos. La UI lo mapea
 * a un mensaje tipo "El place está cerrado — abrimos {opensAt}".
 *
 * `opensAt` puede ser `null` si el place está `unconfigured` (sin horario).
 *
 * Ver `docs/features/hours/spec.md` § "Errores estructurados".
 */
export class OutOfHoursError extends DomainError {
  constructor(
    message: string,
    public readonly placeId: string,
    public readonly opensAt: Date | null,
  ) {
    super('OUT_OF_HOURS', message, { placeId, opensAt })
  }
}

/**
 * Falló la generación del magic link de Supabase Auth. Caso no recuperable:
 * ya se intentó invite → fallback magiclink y ambos retornaron error. El
 * `Invitation` row ya fue creado pero la UI debe mostrar error y permitir
 * reintentar manualmente.
 */
export class InvitationLinkGenerationError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('INVITATION_LINK_GENERATION', message, context)
  }
}

/**
 * El mailer (Resend) rechazó el envío. `Invitation.deliveryStatus=FAILED`
 * queda registrado; el admin puede reenviar desde la UI.
 */
export class InvitationEmailFailedError extends DomainError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('INVITATION_EMAIL_FAILED', message, context)
  }
}

/**
 * Type guard **shape-based** (no `instanceof`). Requerido porque la serialización
 * de Next 15 pierde la prototype chain en server action → cliente. Chequea
 * `code` enumerable con valor en `DOMAIN_ERROR_CODES` + `message` string.
 *
 * Acepta tanto instancias de `DomainError` del lado server como objetos
 * deserializados del lado client.
 */
export function isDomainError(
  err: unknown,
): err is { code: DomainErrorCode; message: string; context?: Record<string, unknown> } {
  if (err === null || typeof err !== 'object') return false
  const obj = err as { code?: unknown; message?: unknown }
  return (
    typeof obj.code === 'string' &&
    DOMAIN_ERROR_CODE_SET.has(obj.code) &&
    typeof obj.message === 'string'
  )
}
