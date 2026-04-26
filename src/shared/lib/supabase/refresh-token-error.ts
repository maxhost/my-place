import { isAuthApiError } from '@supabase/supabase-js'

/**
 * Detecta errores de refresh token que indican una sesión inválida pero
 * recuperable: el cliente debe ser deslogueado limpiamente y redirigido a
 * `/login` en vez de explotar con un error overlay.
 *
 * Casos cubiertos:
 *  - `refresh_token_already_used`: race condition cuando dos requests
 *    paralelas intentan rotar el mismo refresh token (común en dev con
 *    prefetching + clicks rápidos; raro pero posible en prod).
 *  - `refresh_token_not_found`: el token fue revocado server-side o caducó.
 *  - `session_not_found` / `session_expired`: la sesión asociada ya no
 *    existe (logout en otro device, expire absoluto).
 *
 * No cubre errores de red (`AuthRetryableFetchError`) ni fallos genéricos
 * — esos se propagan para que el caller los vea.
 */
const STALE_SESSION_CODES = new Set<string>([
  'refresh_token_already_used',
  'refresh_token_not_found',
  'session_not_found',
  'session_expired',
])

export function isStaleSessionError(error: unknown): boolean {
  if (!isAuthApiError(error)) return false
  if (error.code && STALE_SESSION_CODES.has(error.code)) return true
  // Fallback por mensaje cuando el server no devuelve `code` (Supabase legacy).
  const msg = error.message?.toLowerCase() ?? ''
  return (
    msg.includes('refresh token') && (msg.includes('already used') || msg.includes('not found'))
  )
}
