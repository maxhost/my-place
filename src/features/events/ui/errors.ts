/**
 * Mapper de errores de dominio del slice events a copy amistoso en español.
 * Mismo patrón que `discussions/ui/utils.ts:friendlyErrorMessage`.
 */

import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  OutOfHoursError,
  ValidationError,
  isDomainError,
} from '@/shared/errors/domain-error'

export function friendlyEventErrorMessage(err: unknown): string {
  if (err instanceof OutOfHoursError) return 'El place está cerrado ahora.'
  if (err instanceof AuthorizationError) return 'No tenés permiso para hacer esto.'
  // ValidationError mensajes son ya user-facing y descriptivos (ej: "La hora
  // de fin debe ser posterior a la de inicio"). Los surface tal cual en vez
  // del genérico "Revisá los datos del formulario" para que el user sepa
  // QUÉ está mal.
  if (err instanceof ValidationError) {
    return err.message || 'Revisá los datos del formulario.'
  }
  if (err instanceof ConflictError)
    return 'Conflicto: el evento puede estar cancelado o haber cambiado.'
  if (err instanceof NotFoundError) return 'Este evento ya no está disponible.'
  if (isDomainError(err)) return 'Algo no salió bien. Reintentá en un momento.'
  return 'Algo no salió bien. Reintentá en un momento.'
}
