/**
 * Tipos del sistema de diagnóstico TEMPORAL del flow auth.
 *
 * Eventos categorizados por área. Si agregás uno nuevo, sumalo acá para
 * evitar typos al callsite. Cuando borremos el sistema (pre-launch), este
 * archivo desaparece junto con el resto de `src/shared/lib/diag/`.
 *
 * Ver `docs/pre-launch-checklist.md` y `MEMORY.md` (no aplica).
 */

export type DiagSeverity = 'info' | 'warn' | 'error'

export type DiagSessionState = 'present' | 'absent' | 'error'

/**
 * Tipos de evento permitidos. Estructura: `<area>_<step>` para queries fáciles.
 *
 * - `mw_*`: middleware (entry, gate decisions, errors, cookie cleanups).
 * - `cb_pkce_*`: /auth/callback (magic link PKCE).
 * - `cb_invite_*`: /auth/invite-callback (verifyOtp).
 * - `logout_*`: server action de logout.
 * - `session_*`: getUser/getSession failures detectados desde server code.
 * - `rls_*`: errores RLS de Supabase capturados.
 * - `http_*`: catch-all responses no-2xx interesantes.
 */
export type DiagEvent =
  | 'mw_entry'
  | 'mw_gate_redirect_to_login'
  | 'mw_session_error'
  | 'mw_stale_cleanup'
  | 'mw_proactive_residual_cleanup'
  | 'cb_pkce_entry'
  | 'cb_pkce_missing_code'
  | 'cb_pkce_exchange_failed'
  | 'cb_pkce_user_sync_failed'
  | 'cb_pkce_success'
  | 'cb_invite_entry'
  | 'cb_invite_missing_token'
  | 'cb_invite_invalid_type'
  | 'cb_invite_verify_failed'
  | 'cb_invite_user_sync_failed'
  | 'cb_invite_accept_inline'
  | 'cb_invite_accept_failed'
  | 'cb_invite_success'
  | 'logout_entry'
  | 'logout_signout_failed'
  | 'logout_success'
  | 'session_get_user_unexpected_null'
  | 'session_get_user_error'
  | 'rls_denied'
  | 'http_403'
  | 'http_404'
  | 'http_401'

export type DiagPayload = Record<string, unknown>

export type DiagContext = {
  traceId: string
  host: string
  path: string
  method: string
  userId?: string | null
  sessionState?: DiagSessionState
  cookieNames?: string[]
  userAgent?: string | null
  ipPrefix?: string | null
}

export type DiagRecord = DiagContext & {
  event: DiagEvent
  severity: DiagSeverity
  payload: DiagPayload
}
