import { describe, expect, it } from 'vitest'
import { friendlyErrorMessage } from '../ui/utils'
import { EditSessionInvalid } from '@/shared/errors/edit-session-errors'

/**
 * Audit #1 (robust). La clase EditSessionInvalid vive en
 * `@/shared/errors/edit-session-errors` (no server-only) precisamente para
 * que el helper de UI pueda discriminarla por `instanceof` y que este test
 * pueda instanciarla sin tocar `node:crypto` ni el secret server.
 */
describe('friendlyErrorMessage — Audit #1: EditSessionInvalid copy específico', () => {
  it('reason="expired" → mensaje claro con CTA "abrí el editor de nuevo"', () => {
    const msg = friendlyErrorMessage(new EditSessionInvalid('expired'))
    expect(msg).toContain('La sesión de edición venció')
    expect(msg).toContain('abrir el editor')
  })

  it('reason="bad_signature" → mensaje "no es válida" con misma CTA', () => {
    const msg = friendlyErrorMessage(new EditSessionInvalid('bad_signature'))
    expect(msg).toContain('La sesión de edición no es válida')
    expect(msg).toContain('abrir el editor')
  })

  it('reason="malformed" → cae al mismo "no es válida"', () => {
    const msg = friendlyErrorMessage(new EditSessionInvalid('malformed'))
    expect(msg).toContain('La sesión de edición no es válida')
  })

  it('reason="future_opened_at" → mensaje "no es válida"', () => {
    const msg = friendlyErrorMessage(new EditSessionInvalid('future_opened_at'))
    expect(msg).toContain('La sesión de edición no es válida')
  })

  it('reason="subject_mismatch" → mensaje "no es válida"', () => {
    const msg = friendlyErrorMessage(new EditSessionInvalid('subject_mismatch'))
    expect(msg).toContain('La sesión de edición no es válida')
  })

  it('regression guard: NO cae al fallback "Algo no salió bien"', () => {
    // Si alguien removiera el branch EditSessionInvalid del helper, el error
    // caería al fallback genérico — este test rompe primero.
    const msg = friendlyErrorMessage(new EditSessionInvalid('expired'))
    expect(msg).not.toContain('Algo no salió bien')
  })
})
