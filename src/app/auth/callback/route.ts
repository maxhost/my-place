import { type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { prisma } from '@/db/client'
import { clientEnv } from '@/shared/config/env'
import { createRequestLogger, REQUEST_ID_HEADER } from '@/shared/lib/request-id'
import { InvalidMagicLinkError, UserSyncError } from '@/shared/errors/auth'
import { cookieDomain } from '@/shared/lib/supabase/cookie-domain'
import {
  applyCookies,
  buildLegacyCookieCleanup,
  type CookieToSet,
} from '@/shared/lib/supabase/cookie-cleanup'
import { extractProjectRef } from '@/shared/lib/supabase/build-session-cookies'
import { resolveNextRedirect } from '@/shared/lib/next-redirect'
import { htmlRedirect } from '@/shared/lib/auth-redirect-html'
import { extractCookieNames, logDiag, truncateIp } from '@/shared/lib/diag/public'
import { deriveDisplayName } from './helpers'

/**
 * GET /auth/callback?code=...&next=...
 *
 * Callback PKCE para magic links generados por `signInWithOtp` desde el
 * browser. Mismo patrón que `/auth/invite-callback` (cookie bag + htmlRedirect
 * + setSession). Ver comentarios ahí.
 *
 * **DIAG TEMPORAL:** instrumentado con `logDiag(...)` (tabla `DiagnosticLog`).
 * Borrar entries pre-launch (ver `docs/pre-launch-checklist.md`).
 */
export async function GET(req: NextRequest) {
  const traceId = req.headers.get(REQUEST_ID_HEADER) ?? 'unknown'
  const log = createRequestLogger(traceId)
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const rawNext = url.searchParams.get('next')

  const baseDiagCtx = {
    traceId,
    host: req.headers.get('host') ?? '?',
    path: url.pathname,
    method: 'GET',
    cookieNames: extractCookieNames(req.cookies.getAll()),
    userAgent: req.headers.get('user-agent'),
    ipPrefix: truncateIp(req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip')),
  }

  logDiag(
    'cb_pkce_entry',
    {
      hasCode: !!code,
      codeLen: code?.length ?? 0,
      rawNext,
    },
    baseDiagCtx,
  )

  if (!code) {
    logDiag('cb_pkce_missing_code', {}, baseDiagCtx, 'warn')
    log.warn({ err: new InvalidMagicLinkError('missing code') }, 'callback_missing_code')
    return htmlRedirect(buildLoginUrl('invalid_link'))
  }

  const cookieBag: CookieToSet[] = []
  const projectRef = extractProjectRef(clientEnv.NEXT_PUBLIC_SUPABASE_URL)
  cookieBag.push(...buildLegacyCookieCleanup(req, { currentProjectRef: projectRef }))

  const domain = cookieDomain(clientEnv.NEXT_PUBLIC_APP_DOMAIN)
  // SDK setAll captura cookies en bag (formato canónico del SDK con
  // refresh_token válido server-side).
  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const c of cookiesToSet) {
            cookieBag.push({
              name: c.name,
              value: c.value,
              options: { ...c.options, ...(domain ? { domain } : {}) },
            })
          }
        },
      },
    },
  )

  const { data: exchange, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !exchange.user || !exchange.session) {
    logDiag(
      'cb_pkce_exchange_failed',
      {
        errorCode: (error as { code?: string } | null)?.code ?? null,
        errorMessage: error?.message ?? null,
        hasUser: !!exchange?.user,
        hasSession: !!exchange?.session,
      },
      baseDiagCtx,
      'warn',
    )
    log.warn(
      { err: new InvalidMagicLinkError(error?.message ?? 'no user/session') },
      'callback_exchange_failed',
    )
    return finalize(htmlRedirect(buildLoginUrl('invalid_link')), cookieBag)
  }

  const { user } = exchange
  const userDiagCtx = { ...baseDiagCtx, userId: user.id, sessionState: 'present' as const }

  // Drain microtasks → onAuthStateChange listener corre → setAll captura
  // session cookies con formato canónico del SDK.
  await new Promise<void>((resolve) => setImmediate(resolve))
  try {
    const email = user.email ?? null
    await prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: email ?? fallbackEmail(user.id),
        displayName: deriveDisplayName(email, user.user_metadata),
      },
      update: email ? { email } : {},
    })
  } catch (syncErr) {
    logDiag(
      'cb_pkce_user_sync_failed',
      {
        errMessage: syncErr instanceof Error ? syncErr.message : String(syncErr),
      },
      userDiagCtx,
      'error',
    )
    log.error({ err: syncErr, userId: user.id }, 'user_sync_failed')
    await supabase.auth.signOut().catch(() => {})
    return finalize(
      htmlRedirect(buildLoginUrl('sync', new UserSyncError('user upsert failed'))),
      cookieBag,
    )
  }

  const redirectTarget = resolveNextRedirect(rawNext)

  logDiag(
    'cb_pkce_success',
    {
      redirectTarget: redirectTarget.toString(),
      bagSize: cookieBag.length,
      bagCookieNames: cookieBag.map((c) => c.name),
    },
    userDiagCtx,
  )

  log.info({ userId: user.id }, 'callback_success')
  return finalize(htmlRedirect(redirectTarget), cookieBag)
}

function finalize(response: ReturnType<typeof htmlRedirect>, bag: CookieToSet[]) {
  applyCookies(response, bag)
  return response
}

function buildLoginUrl(error: 'invalid_link' | 'sync', _cause?: Error): URL {
  return new URL(`/login?error=${error}`, clientEnv.NEXT_PUBLIC_APP_URL)
}

function fallbackEmail(userId: string): string {
  return `${userId}@noemail.place.local`
}
