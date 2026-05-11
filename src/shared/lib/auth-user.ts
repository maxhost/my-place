import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { AuthorizationError } from '@/shared/errors/domain-error'
import { createSupabaseServer } from './supabase/server'
import { isStaleSessionError } from './supabase/refresh-token-error'
import { logger } from './logger'
import { logDiag } from './diag/public'
import { REQUEST_ID_HEADER } from './request-id'

export type AuthUser = { id: string; email: string | null }

/**
 * Sesión activa del request, cacheada via `React.cache`. Cualquier layout, page,
 * loader o RSC puede llamarlo sin disparar round-trips extra al endpoint de
 * Supabase Auth — todas las invocaciones en el mismo render comparten el
 * resultado. Retorna `null` si no hay sesión (el caller decide si redirigir o
 * tirar `AuthorizationError`).
 *
 * **DIAG TEMPORAL:** loggea via `logDiag` los unexpected nulls + errores
 * (con context de host/path) — borrar entries pre-launch (ver
 * `docs/pre-launch-checklist.md`).
 */
export const getCurrentAuthUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createSupabaseServer()
  // El middleware ya intentó refrescar tokens stale (ver
  // `supabase/middleware.ts`). Si igual llega un AuthApiError de refresh
  // acá, tratarlo como anonymous evita crashear el render — el siguiente
  // hop hará el redirect correspondiente.
  try {
    const { data } = await supabase.auth.getUser()
    if (!data.user) {
      void emitDiag('session_get_user_unexpected_null', { layer: 'rsc' }, 'warn').catch(() => {})
      return null
    }
    return { id: data.user.id, email: data.user.email ?? null }
  } catch (err) {
    const e = err as { code?: string; message?: string; name?: string; status?: number }
    void emitDiag(
      'session_get_user_error',
      {
        layer: 'rsc',
        errName: e?.name ?? null,
        errCode: e?.code ?? null,
        errStatus: e?.status ?? null,
        errMessage: e?.message ?? null,
        isStale: isStaleSessionError(err),
      },
      'error',
    ).catch(() => {})

    if (!isStaleSessionError(err)) {
      // DURANTE DIAGNÓSTICO: tratar como anonymous en lugar de propagar
      // (para no crashear el render con error overlay y poder ver el log).
      return null
    }
    logger.warn(
      {
        event: 'authSessionStale',
        layer: 'rsc',
        reason: (err as { code?: string }).code ?? 'unknown',
      },
      'session stale during RSC render — treating as anonymous',
    )
    return null
  }
})

/**
 * Wrapper sobre `getCurrentAuthUser` para server actions: tira
 * `AuthorizationError` con `reason` (mensaje en español, amigable al UI)
 * si no hay sesión. Comparte el cache de `React.cache` — múltiples
 * callsites en el mismo request hacen UN round-trip a Supabase Auth,
 * no N.
 */
export async function requireAuthUserId(reason: string): Promise<string> {
  const user = await getCurrentAuthUser()
  if (!user) throw new AuthorizationError(reason)
  return user.id
}

/**
 * Helper para escribir a DiagnosticLog desde RSC con context auto-resuelto
 * (host/path desde headers, traceId desde x-request-id).
 *
 * Aislado en este módulo para borrarlo junto con el resto del DIAG TEMPORAL.
 */
async function emitDiag(
  event: 'session_get_user_unexpected_null' | 'session_get_user_error',
  payload: Record<string, unknown>,
  severity: 'warn' | 'error',
): Promise<void> {
  try {
    const h = await headers()
    logDiag(
      event,
      payload,
      {
        traceId: h.get(REQUEST_ID_HEADER) ?? 'unknown',
        host: h.get('host') ?? '?',
        path: h.get('x-pathname') ?? '?',
        method: 'RSC',
        userAgent: h.get('user-agent'),
      },
      severity,
    )
  } catch {
    // headers() puede fallar fuera de request scope; ignorar silently.
  }
}
