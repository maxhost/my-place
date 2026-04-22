import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  OutOfHoursError,
  ValidationError,
  isDomainError,
} from '@/shared/errors/domain-error'
import {
  CommentDeletedError,
  EditWindowExpired,
  InvalidMention,
  InvalidQuoteTarget,
  PostHiddenError,
  RichTextTooLarge,
} from '../domain/errors'

/**
 * Mapea errores del dominio a copy amistoso en español para render en UI.
 * Se chequea primero por clase específica (EditWindowExpired, etc.) y luego
 * por clase base. Nunca se muestra el `err.message` crudo al usuario para no
 * exponer detalles internos.
 */
export function friendlyErrorMessage(err: unknown): string {
  if (err instanceof EditWindowExpired) return 'Ya pasó el minuto para editar.'
  if (err instanceof InvalidQuoteTarget) return 'No podés citar ese comentario.'
  if (err instanceof RichTextTooLarge) return 'El texto es muy largo. Acortá y volvé a intentar.'
  if (err instanceof InvalidMention) return 'Las menciones deben ser miembros activos del place.'
  if (err instanceof PostHiddenError || err instanceof CommentDeletedError) {
    return 'Este contenido ya no está disponible.'
  }
  if (err instanceof OutOfHoursError) return 'El place está cerrado ahora.'
  if (err instanceof AuthorizationError) return 'No tenés permiso para hacer esto.'
  if (err instanceof ValidationError) return 'Revisá los datos del formulario.'
  if (err instanceof ConflictError) return 'Alguien lo modificó antes. Recargá y probá de nuevo.'
  if (err instanceof NotFoundError) return 'Esto ya no está disponible.'
  if (isDomainError(err)) return 'Algo no salió bien. Reintentá en un momento.'
  return 'Algo no salió bien. Reintentá en un momento.'
}
