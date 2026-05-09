import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  OutOfHoursError,
  ValidationError,
  isDomainError,
} from '@/shared/errors/domain-error'
import { EditSessionInvalid } from '@/shared/errors/edit-session-errors'
import {
  CommentDeletedError,
  EditWindowExpired,
  InvalidMention,
  InvalidQuoteTarget,
  PostHiddenError,
  SlugCollisionExhausted,
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
  // stub F.1: RichTextTooLarge se reintroduce en F.2 con Lexical.
  if (err instanceof InvalidMention) return 'Las menciones deben ser miembros activos del place.'
  if (err instanceof PostHiddenError || err instanceof CommentDeletedError) {
    return 'Este contenido ya no está disponible.'
  }
  if (err instanceof SlugCollisionExhausted)
    return 'No pudimos generar una URL única. Probá con otro título.'
  // Cross-boundary fallback: tras serializar por Next 15 se pierde la prototype
  // chain, el `instanceof` de arriba falla; discriminamos por el `name` que el
  // constructor base asigna como own-enumerable (sobrevive JSON.stringify).
  if (isDomainError(err) && (err as { name?: string }).name === 'SlugCollisionExhausted') {
    return 'No pudimos generar una URL única. Probá con otro título.'
  }
  // Audit #1 (robust): EditSessionInvalid se discrimina por instanceof — la
  // clase vive en `@/shared/errors/edit-session-errors` (no server-only)
  // específicamente para poder importarla acá. Antes era string-matching por
  // `name` y rename silencioso de la clase caía al fallback genérico. Ahora
  // typecheck-enforced: si renombran la clase, el build rompe. Sin este case,
  // el viewer veía "Algo no salió bien" y volvía a intentar guardar con el
  // token expirado en loop.
  if (err instanceof EditSessionInvalid) {
    const reason = (err.context as { reason?: string } | undefined)?.reason
    if (reason === 'expired') {
      return 'La sesión de edición venció. Cerrá y volvé a abrir el editor para continuar.'
    }
    return 'La sesión de edición no es válida. Cerrá y volvé a abrir el editor.'
  }
  if (err instanceof OutOfHoursError) return 'El place está cerrado ahora.'
  if (err instanceof AuthorizationError) return 'No tenés permiso para hacer esto.'
  if (err instanceof ValidationError) return 'Revisá los datos del formulario.'
  if (err instanceof ConflictError) return 'Alguien lo modificó antes. Recargá y probá de nuevo.'
  if (err instanceof NotFoundError) return 'Esto ya no está disponible.'
  if (isDomainError(err)) return 'Algo no salió bien. Reintentá en un momento.'
  return 'Algo no salió bien. Reintentá en un momento.'
}
