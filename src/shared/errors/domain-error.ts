/**
 * Jerarquía de errores de dominio tipados.
 *
 * Los invariantes de `docs/data-model.md` (max 150 miembros, min 1 owner, slug inmutable,
 * etc.) se expresan como subclases específicas de `InvariantViolation` en cada feature.
 *
 * Uso: nunca lanzar `new Error(...)` desde domain services. Siempre una subclase de DomainError
 * para poder discriminar en logging, mapeo a HTTP, y feedback al usuario.
 */
export type DomainErrorCode =
  | 'INVARIANT_VIOLATION'
  | 'AUTHORIZATION'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'OUT_OF_HOURS'

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode

  constructor(
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

/** Un invariante del dominio fue violado. Ej: sumar el miembro 151, quedar sin owner. */
export class InvariantViolation extends DomainError {
  readonly code = 'INVARIANT_VIOLATION' as const
}

/** El actor no tiene permisos para la operación. */
export class AuthorizationError extends DomainError {
  readonly code = 'AUTHORIZATION' as const
}

/** Recurso no encontrado. */
export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND' as const
}

/** Input inválido (formato, tipo). Típicamente viene de Zod. */
export class ValidationError extends DomainError {
  readonly code = 'VALIDATION' as const
}

/** Conflicto de concurrencia o estado. Ej: slug duplicado, racing conditions. */
export class ConflictError extends DomainError {
  readonly code = 'CONFLICT' as const
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
  readonly code = 'OUT_OF_HOURS' as const
  constructor(
    message: string,
    public readonly placeId: string,
    public readonly opensAt: Date | null,
  ) {
    super(message, { placeId, opensAt })
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError
}
