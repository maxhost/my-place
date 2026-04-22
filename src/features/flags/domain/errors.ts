/**
 * Errores estructurados del slice `flags`. Extienden categorías del shared.
 * Ver `docs/features/discussions/spec.md` § 15.
 */

import { ConflictError } from '@/shared/errors/domain-error'

/**
 * Ya existe un Flag `OPEN` del mismo reporter sobre el mismo target.
 * La UNIQUE constraint en DB garantiza el invariante; este error cubre el
 * chequeo previo en action para devolver un 409 tipado en vez del bruto.
 */
export class FlagAlreadyExists extends ConflictError {
  constructor(context: { targetType: string; targetId: string; reporterUserId: string }) {
    super('Ya reportaste este contenido.', context)
  }
}
