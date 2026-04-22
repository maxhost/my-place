import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { clientEnv } from '@/shared/config/env'
import { cookieDomain } from './cookie-domain'

/**
 * Refresca la sesión de Supabase en cada request.
 * Patrón oficial de `@supabase/ssr` para Next.js App Router.
 *
 * Retorna `{ response, user }`:
 *  - `response` tiene las cookies actualizadas (rotación de refresh token).
 *  - `user` es el usuario autenticado o `null` si no hay sesión.
 *
 * El caller debe copiar los headers/cookies del `response` devuelto a la respuesta
 * final (ver `src/middleware.ts`).
 */
export async function updateSession(req: NextRequest): Promise<{
  response: NextResponse
  user: { id: string; email: string | null } | null
}> {
  let response = NextResponse.next({ request: req })
  const domain = cookieDomain(clientEnv.NEXT_PUBLIC_APP_DOMAIN)

  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            req.cookies.set(name, value)
          }
          response = NextResponse.next({ request: req })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, { ...options, ...(domain ? { domain } : {}) })
          }
        },
      },
    },
  )

  const { data } = await supabase.auth.getUser()
  const user = data.user ? { id: data.user.id, email: data.user.email ?? null } : null

  return { response, user }
}
