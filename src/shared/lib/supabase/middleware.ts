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

  // DEBUG TEMPORAL — log de cookies entrantes + decoded session en TODOS los paths.
  // Decodea sb-*-auth-token (formato base64-{json}) para extraer expires_at del
  // access_token + first/last 8 chars del refresh_token. Permite trackear
  // identidad/rotación del token a lo largo del flow.
  const path = req.nextUrl.pathname
  const host = req.headers.get('host') ?? '?'
  const traceId = req.nextUrl.searchParams.get('_t') ?? 'no-trace'
  const sbCookies = req.cookies.getAll().filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
  const sbCookieSummary = sbCookies.map((c) => `${c.name}(${c.value?.length ?? 0})`).join(',')
  // DEBUG TEMPORAL — currentProjectRef del env para detectar mismatch storage<>cookie.
  const currentRef = clientEnv.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)?.[1] ?? '?'
  const cookiesForCurrent = sbCookies
    .filter((c) => c.name.startsWith(`sb-${currentRef}-`))
    .map((c) => c.name)
    .join(',')
  let decodedSession = ''
  try {
    const chunks = sbCookies
      .filter((c) => /-auth-token(\.\d+)?$/.test(c.name) && !/code-verifier/.test(c.name))
      .sort((a, b) => a.name.localeCompare(b.name))
    const raw = chunks.map((c) => c.value).join('')
    if (raw.startsWith('base64-')) {
      const json = Buffer.from(raw.slice('base64-'.length), 'base64').toString('utf8')
      const parsed = JSON.parse(json) as {
        access_token?: string
        refresh_token?: string
        expires_at?: number
      }
      const rt = parsed.refresh_token ?? ''
      const rtFp = rt ? `${rt.slice(0, 8)}…${rt.slice(-4)}(${rt.length})` : 'none'
      const expSec = parsed.expires_at ?? 0
      const nowSec = Math.floor(Date.now() / 1000)
      const ttl = expSec - nowSec
      decodedSession = `rt=${rtFp} exp=${expSec} ttl=${ttl}s`
    }
  } catch (decodeErr) {
    decodedSession = `decode_err=${(decodeErr as Error).message}`
  }
  logger.warn(
    {
      debug: 'MW_entry',
      traceId,
      host,
      path,
      sbCookieSummary,
      decodedSession,
      currentRef,
      cookiesForCurrent,
    },
    `DBG MW[entry] tr=${traceId} host=${host} path=${path} ref=${currentRef} forCur=[${cookiesForCurrent || '(none)'}] sb=[${sbCookieSummary || '(none)'}] sess=[${decodedSession || '(none)'}]`,
  )
  const isAuthFlowPath = true // log siempre durante diagnóstico

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
    // DEBUG TEMPORAL — JSON.stringify del data completo retornado por SDK.
    // Trunca para no llenar logs (access_token tiene ~700 chars).
    let rawSessionDump = ''
    try {
      const dump = JSON.stringify(data, (_k, v) =>
        typeof v === 'string' && v.length > 40 ? `${v.slice(0, 20)}…(${v.length})` : v,
      )
      rawSessionDump = dump.length > 800 ? `${dump.slice(0, 800)}…` : dump
    } catch (jsonErr) {
      rawSessionDump = `dump_err=${(jsonErr as Error).message}`
    }
    logger.warn(
      { debug: 'MW_getSession_raw', traceId, host, path, rawSessionDump },
      `DBG MW[getSession-raw] tr=${traceId} host=${host} path=${path} data=${rawSessionDump}`,
    )
    user = data.session?.user
      ? { id: data.session.user.id, email: data.session.user.email ?? null }
      : null
    if (isAuthFlowPath) {
      // DEBUG TEMPORAL — dump COMPLETO del session retornado por SDK.
      const s = data.session
      const sessionDebug = s
        ? `hasSession=true exp=${s.expires_at ?? '?'} userId=${s.user?.id?.slice(0, 8) ?? '?'} accessLen=${s.access_token?.length ?? 0} refreshLen=${s.refresh_token?.length ?? 0}`
        : 'hasSession=false'
      logger.warn(
        {
          debug: 'MW_getSession',
          traceId,
          path,
          host,
          hasUser: !!user,
          userId: user?.id ?? null,
          sessionDebug,
        },
        `DBG MW[getSession] tr=${traceId} host=${host} path=${path} user=${user?.id ?? 'null'} session=[${sessionDebug}]`,
      )
    }
  } catch (err) {
    // DEBUG TEMPORAL — capturar TODO el error antes de cualquier filtro.
    const e = err as { code?: string; message?: string; name?: string; status?: number }
    logger.warn(
      {
        debug: 'MW_getSession_error',
        traceId,
        path,
        errName: e?.name ?? null,
        errCode: e?.code ?? null,
        errStatus: e?.status ?? null,
        errMessage: e?.message ?? null,
        isStale: isStaleSessionError(err),
      },
      `DBG MW[getSession-err] tr=${traceId} path=${path} name=${e?.name} code=${e?.code} status=${e?.status} msg=${e?.message} stale=${isStaleSessionError(err)}`,
    )
    if (!isStaleSessionError(err)) {
      // DURANTE DIAGNÓSTICO: no re-throw para no crashear MW. Tratar como anonymous.
      // El user verá redirect a login (igual que stale) y veremos el log error.
      user = null
      return { response, user }
    }
    logger.warn(
      { event: 'authSessionStale', reason: (err as { code?: string }).code ?? 'unknown' },
      'session stale — clearing cookies and treating as anonymous',
    )
    // `signOut({ scope: 'local' })` no llama a Supabase; sólo limpia cookies
    // locales via el callback `setAll` configurado arriba, que también se
    // refleja en `response.cookies` (Domain=apex preservado).
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})

    // **Cleanup defensivo HOST-ONLY:** signOut limpia con `Domain=apex` (el
    // domain configurado en el cookies adapter de arriba). Pero pueden
    // coexistir cookies residuales con `Domain=<host actual>` (host-only)
    // de flows previos — esas tienen precedencia sobre las apex-domain por
    // RFC 6265 (cookies más específicas primero). Si no las limpiamos, el
    // próximo request las re-envía y el SDK falla otra vez con stale.
    //
    // Emitimos Max-Age=0 SIN domain (host-only) para `sb-{currentRef}-auth-token`
    // y sus chunks `.0/.1/...`. **Filtro por currentRef:** no tocamos cookies
    // de OTROS proyectos Supabase coexistentes en el browser (un user puede
    // tener sesiones simultáneas en varios productos basados en Supabase). Si
    // borráramos sin filtro, romperíamos esas sesiones legítimas.
    //
    // Ver `docs/decisions/2026-05-10-cookie-residual-host-only-cleanup.md`.
    const cleanupRe = new RegExp(`^sb-${currentRef}-auth-token(\\.\\d+)?$`)
    const clearedNames: string[] = []
    for (const cookie of req.cookies.getAll()) {
      if (!cleanupRe.test(cookie.name)) continue
      response.headers.append(
        'Set-Cookie',
        `${cookie.name}=; Path=/; Max-Age=0; Secure; SameSite=Lax`,
      )
      clearedNames.push(cookie.name)
    }
    logger.warn(
      {
        debug: 'MW_stale_cleanup',
        host,
        path,
        currentRef,
        clearedCount: clearedNames.length,
        clearedNames,
      },
      `DBG MW[stale-cleanup] host=${host} path=${path} ref=${currentRef} cleared=${clearedNames.length} names=[${clearedNames.join(',')}]`,
    )
  }

  return { response, user }
}
