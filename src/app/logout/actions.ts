'use server'

import { cookies as nextCookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/shared/lib/supabase/server'
import { createRequestLogger, REQUEST_ID_HEADER } from '@/shared/lib/request-id'
import { apexUrl } from '@/shared/lib/app-url'
import { extractCookieNames, logDiag, truncateIp } from '@/shared/lib/diag/public'

/**
 * Server action de logout. Llama a `supabase.auth.signOut()` (escribe Set-Cookie
 * con `Max-Age=0` para todas las sb-* cookies via el adapter `setAll` configurado
 * en `createSupabaseServer`) y redirige al apex.
 *
 * **DIAG TEMPORAL:** instrumentado con `logDiag(...)` (tabla `DiagnosticLog`).
 * Borrar entries pre-launch (ver `docs/pre-launch-checklist.md`).
 */
export async function logout(): Promise<void> {
  const headerStore = await headers()
  const cookieStore = await nextCookies()
  const traceId = headerStore.get(REQUEST_ID_HEADER) ?? 'unknown'
  const log = createRequestLogger(traceId)

  const baseDiagCtx = {
    traceId,
    host: headerStore.get('host') ?? '?',
    path: '/logout',
    method: 'POST',
    cookieNames: extractCookieNames(cookieStore.getAll()),
    userAgent: headerStore.get('user-agent'),
    ipPrefix: truncateIp(headerStore.get('x-forwarded-for') ?? headerStore.get('x-real-ip')),
  }

  logDiag('logout_entry', { incomingCookieCount: baseDiagCtx.cookieNames.length }, baseDiagCtx)

  const supabase = await createSupabaseServer()
  const { error } = await supabase.auth.signOut()

  if (error) {
    logDiag(
      'logout_signout_failed',
      {
        errCode: (error as { code?: string }).code ?? null,
        errStatus: (error as { status?: number }).status ?? null,
        errMessage: error.message,
      },
      baseDiagCtx,
      'error',
    )
    log.warn({ err: error }, 'logout_failed')
  } else {
    // Read post-signOut cookies para verificar qué quedó.
    const postCookies = await nextCookies()
    const remainingSb = extractCookieNames(postCookies.getAll())
    logDiag(
      'logout_success',
      {
        redirectTarget: apexUrl().toString(),
        remainingSbCookies: remainingSb,
      },
      baseDiagCtx,
    )
    log.info({}, 'logout_success')
  }

  redirect(apexUrl().toString())
}
