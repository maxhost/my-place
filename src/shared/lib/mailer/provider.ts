import 'server-only'
import { serverEnv } from '@/shared/config/env'
import type { Mailer } from './types'
import { ResendMailer } from './resend-mailer'
import { FakeMailer } from './fake-mailer'

/**
 * Factory singleton del mailer. Elige proveedor por env:
 *
 * - `RESEND_API_KEY` + `EMAIL_FROM` presentes → `ResendMailer`.
 * - Ausentes en dev/test → `FakeMailer` (fallback explícito).
 * - Ausentes en `production` → crash: ya validado en `env.ts` al boot.
 *
 * Para tests: `setMailer(custom)` inyecta un mailer específico y desactiva
 * el cache hasta que `resetMailer()` lo restaure.
 */

let _mailer: Mailer | null = null
let _overridden = false

export function getMailer(): Mailer {
  if (_mailer) return _mailer
  _mailer = buildDefaultMailer()
  return _mailer
}

/** Inyección para tests. Persiste hasta `resetMailer`. */
export function setMailer(mailer: Mailer): void {
  _mailer = mailer
  _overridden = true
}

/** Restaura el factory al comportamiento por env. Usar en `afterEach`. */
export function resetMailer(): void {
  _mailer = null
  _overridden = false
}

/** Expuesto solo para introspección en tests (debug). */
export function isMailerOverridden(): boolean {
  return _overridden
}

function buildDefaultMailer(): Mailer {
  const apiKey = serverEnv.RESEND_API_KEY
  const from = serverEnv.EMAIL_FROM

  if (apiKey && from) {
    return new ResendMailer({ apiKey, from })
  }

  if (serverEnv.NODE_ENV === 'production') {
    // No debería llegar acá: `env.ts` chequea prod-required en el parseo.
    // Guard defensivo por si se llama antes de que el Proxy se haya tocado.
    throw new Error(
      '[mailer] RESEND_API_KEY + EMAIL_FROM requeridas en producción. Ver .env.example.',
    )
  }

  // dev/test: fallback transparente + hint amigable en stdout.
  console.warn('[mailer] Sin RESEND_API_KEY: usando FakeMailer. Los emails se loguean a stdout.')
  return new FakeMailer()
}
