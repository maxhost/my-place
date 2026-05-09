import { DomainError } from './domain-error'

/**
 * Error de validación del token HMAC de edit-session.
 *
 * **Por qué vive acá y NO en `shared/lib/edit-session-token.ts`**: la lógica
 * de sign/verify del HMAC requiere `node:crypto` y el secret server-side, así
 * que el módulo padre tiene `import 'server-only'` y no puede ser importado
 * desde código cliente. Pero **la clase del error es pura** (sólo extiende
 * `DomainError` con un `reason`), y el helper `friendlyErrorMessage` del
 * cliente necesita discriminarla por `instanceof` para mostrar copy
 * específico ("La sesión de edición venció. Cerrá y volvé a abrir el editor").
 *
 * Antes vivía en el módulo server-only y el cliente la discriminaba por
 * `name === 'EditSessionInvalid'` — funcional pero frágil: rename silencioso
 * caía al fallback genérico. Extraerla acá hace que `instanceof` funcione
 * en ambos lados y rompa el typecheck si alguien renombra.
 *
 * Ver `docs/decisions/2026-04-21-edit-session-token.md`.
 */
export type EditSessionInvalidReason =
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'future_opened_at'
  | 'subject_mismatch'

export class EditSessionInvalid extends DomainError {
  constructor(reason: EditSessionInvalidReason, context?: Record<string, unknown>) {
    super('AUTHORIZATION', 'Sesión de edición inválida o expirada.', {
      reason,
      ...context,
    })
  }
}
