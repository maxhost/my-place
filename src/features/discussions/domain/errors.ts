/**
 * Errores estructurados del slice `discussions`. Todos extienden las categorías
 * base en `shared/errors/domain-error`. El mapeo a HTTP y a mensaje UI vive
 * upstream (server actions, ui bridge) — acá solo declaramos el shape.
 *
 * Ver `docs/features/discussions/spec.md` § 15.
 */

import { ConflictError, InvariantViolation, ValidationError } from '@/shared/errors/domain-error'

/**
 * La ventana de edición del autor (60s desde `createdAt`) expiró.
 * Tras expirar, solo admin puede mutar el Post (y solo hide/delete, no editar).
 */
export class EditWindowExpired extends InvariantViolation {
  constructor(context: { entityId: string; createdAt: Date; now: Date; elapsedMs: number }) {
    super('La ventana de edición expiró (60 segundos desde la creación).', context)
  }
}

/**
 * Se intentó comentar/reaccionar/citar sobre un Post con `hiddenAt` seteado.
 * Admin puede seguir operando sobre él (unhide, delete); member no.
 */
export class PostHiddenError extends ConflictError {
  constructor(context: { postId: string; hiddenAt: Date }) {
    super('Este post está oculto por moderación.', context)
  }
}

/** Se intentó operar sobre un Comment con `deletedAt` seteado. */
export class CommentDeletedError extends ConflictError {
  constructor(context: { commentId: string; deletedAt: Date }) {
    super('Este comentario fue eliminado.', context)
  }
}

/**
 * El `quotedCommentId` no es un target válido para el Comment actual.
 * Razones: no existe, pertenece a otro Post, apunta a sí mismo, intenta
 * citar una cita (profundidad >1).
 */
export class InvalidQuoteTarget extends ValidationError {
  constructor(
    reason: 'not_found' | 'cross_post' | 'self' | 'chained_quote',
    context: Record<string, unknown> = {},
  ) {
    const messages: Record<typeof reason, string> = {
      not_found: 'El comentario citado no existe.',
      cross_post: 'No podés citar un comentario de otro post.',
      self: 'Un comentario no puede citarse a sí mismo.',
      chained_quote: 'No se permiten citas encadenadas (máximo 1 nivel).',
    }
    super(messages[reason], { reason, ...context })
  }
}

// stub F.1: `RichTextTooLarge` se reintroduce en F.2 con el límite de Lexical AST.

/**
 * Una mention `{type: 'mention', attrs: { userId, label }}` apunta a un
 * `userId` que no es miembro activo del place. Se enforza server-side
 * durante el parseo de AST — label client no basta.
 */
export class InvalidMention extends ValidationError {
  constructor(context: { userId: string; placeId: string }) {
    super('La mención apunta a un usuario que no es miembro activo.', context)
  }
}

/**
 * `generatePostSlug` no pudo asignar un slug único tras `attemptedSuffixes`
 * intentos (cap de diseño = 1000). Estadísticamente inalcanzable en prod,
 * pero el invariante existe: si se llega acá, el reserved set del place está
 * corrupto o hay un título patológico. Se modela como `InvariantViolation`
 * — no es race/concurrencia (no mapea a `ConflictError`) ni input inválido
 * del usuario (no mapea a `ValidationError`).
 *
 * Cross-boundary (Next 15 server action → cliente): la categoría viaja en
 * `code = 'INVARIANT_VIOLATION'` + la subclase específica en `name =
 * 'SlugCollisionExhausted'`. Ambos son own-enumerable (sobreviven a
 * JSON.stringify). Los catchers en UI/middlewares discriminan por `name` sin
 * depender de `instanceof`. Ver `domain-error.ts` § "boundary de server actions".
 */
export class SlugCollisionExhausted extends InvariantViolation {
  constructor(context: { title: string; candidate: string; attemptedSuffixes: number }) {
    super(`No pudimos asignar una URL única tras ${context.attemptedSuffixes} intentos.`, context)
  }
}
