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

  // DEBUG TEMPORAL — log de cookies entrantes en paths críticos del flow auth.
  const path = req.nextUrl.pathname
  const host = req.headers.get('host') ?? '?'
  const traceId = req.nextUrl.searchParams.get('_t') ?? 'no-trace'
  const isAuthFlowPath =
    path.startsWith('/invite/accept/') ||
    path.startsWith('/auth/') ||
    path === '/login' ||
    path === '/inbox'
  if (isAuthFlowPath) {
    const sbCookieNames = req.cookies
      .getAll()
      .filter((c) => /^sb-/.test(c.name))
      .map((c) => `${c.name}(${c.value?.length ?? 0})`)
      .join(',')
    logger.warn(
      { debug: 'MW_entry', traceId, host, path, sbCookieNames },
      `DBG MW[entry] tr=${traceId} host=${host} path=${path} sb=[${sbCookieNames || '(none)'}]`,
    )
  }

  // **`getSession()` no `getUser()`** — getSession solo lee la cookie y decodea
  // el JWT (sin server validation, sin refresh). getUser hace una llamada al
  // server Supabase y puede disparar refresh internal del SDK. En requests
  // paralelos (browser carga page + assets + favicon simultáneamente), el
  // primer refresh consume el refresh_token y los siguientes throwean
  // "refresh_token_not_found" → middleware hace signOut → user perdió session.
  //
  // Trade-off aceptable: el middleware confía en la cookie hasta que expire.
  // Endpoints críticos (server actions, server components) llaman getUser()
  // para validación fresh. Si sesión revocada en otro device, el user sigue
  // logueado hasta que expire (típicamente 1 hora con auto-refresh por SDK).
  let user: { id: string; email: string | null } | null = null
  try {
    const { data } = await supabase.auth.getSession()
    user = data.session?.user
      ? { id: data.session.user.id, email: data.session.user.email ?? null }
      : null
    if (isAuthFlowPath) {
      logger.warn(
        { debug: 'MW_getSession', traceId, path, hasUser: !!user, userId: user?.id ?? null },
        `DBG MW[getSession] tr=${traceId} path=${path} user=${user?.id ?? 'null'}`,
      )
    }
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
