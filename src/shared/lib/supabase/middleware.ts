import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { clientEnv } from '@/shared/config/env'
import { cookieDomain } from './cookie-domain'
import { isStaleSessionError } from './refresh-token-error'
import { logger } from '@/shared/lib/logger'

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

  // `auth.getUser()` puede disparar refresh interno de Supabase. Si el refresh
  // token está stale (race con otra request paralela, revocación, expire), el
  // SDK tira AuthApiError. En vez de crashear el render, deslogueamos local
  // (limpia las cookies) y devolvemos `user: null` para que el gate redirija
  // a `/login` sin overlay.
  let user: { id: string; email: string | null } | null = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user ? { id: data.user.id, email: data.user.email ?? null } : null
  } catch (err) {
    if (!isStaleSessionError(err)) throw err
    logger.warn(
      { event: 'authSessionStale', reason: (err as { code?: string }).code ?? 'unknown' },
      'session stale — clearing cookies and treating as anonymous',
    )
    // `signOut({ scope: 'local' })` no llama a Supabase; sólo limpia cookies
    // locales via el callback `setAll` configurado arriba, que también se
    // refleja en `response.cookies` (Domain=apex preservado).
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  }

  return { response, user }
}
