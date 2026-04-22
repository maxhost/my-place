import 'server-only'
import { cache } from 'react'
import { createSupabaseServer } from './supabase/server'

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
  const { data } = await supabase.auth.getUser()
  if (!data.user) return null
  return { id: data.user.id, email: data.user.email ?? null }
})
