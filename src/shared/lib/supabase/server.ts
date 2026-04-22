import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { clientEnv } from '@/shared/config/env'
import { cookieDomain } from './cookie-domain'

/**
 * Cliente Supabase para Server Components, Server Actions y Route Handlers.
 * Usa la anon key + cookies para sostener la sesión del usuario.
 */
export async function createSupabaseServer() {
  const cookieStore = await cookies()
  const domain = cookieDomain(clientEnv.NEXT_PUBLIC_APP_DOMAIN)

  return createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, { ...options, ...(domain ? { domain } : {}) })
            }
          } catch {
            // Llamado desde un Server Component (read-only). Next maneja sessions via middleware.
          }
        },
      },
    },
  )
}
