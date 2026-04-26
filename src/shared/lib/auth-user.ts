import 'server-only'
import { cache } from 'react'
import { AuthorizationError } from '@/shared/errors/domain-error'
import { createSupabaseServer } from './supabase/server'
import { isStaleSessionError } from './supabase/refresh-token-error'
import { logger } from './logger'

export type AuthUser = { id: string; email: string | null }

/**
 * Sesión activa del request, cacheada via `React.cache`. Cualquier layout, page,
 * loader o RSC puede llamarlo sin disparar round-trips extra al endpoint de
 * Supabase Auth — todas las invocaciones en el mismo render comparten el
 * resultado. Retorna `null` si no hay sesión (el caller decide si redirigir o
 * tirar `AuthorizationError`).
 */
export const getCurrentAuthUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createSupabaseServer()
  // El middleware ya intentó refrescar tokens stale (ver
  // `supabase/middleware.ts`). Si igual llega un AuthApiError de refresh
  // acá, tratarlo como anonymous evita crashear el render — el siguiente
  // hop hará el redirect correspondiente.
  try {
    const { data } = await supabase.auth.getUser()
    if (!data.user) return null
    return { id: data.user.id, email: data.user.email ?? null }
  } catch (err) {
    if (!isStaleSessionError(err)) throw err
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
