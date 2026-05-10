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
import { buildSessionCookies, extractProjectRef } from '@/shared/lib/supabase/build-session-cookies'
import { resolveNextRedirect } from '@/shared/lib/next-redirect'
import { htmlRedirect } from '@/shared/lib/auth-redirect-html'
import { deriveDisplayName } from './helpers'

/**
 * GET /auth/callback?code=...&next=...
 *
 * Callback PKCE para magic links generados por `signInWithOtp` desde el
 * browser. Mismo patrón que `/auth/invite-callback` (cookie bag + htmlRedirect
 * + setSession). Ver comentarios ahí.
 */
export async function GET(req: NextRequest) {
  const log = createRequestLogger(req.headers.get(REQUEST_ID_HEADER) ?? 'unknown')
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const rawNext = url.searchParams.get('next')

  if (!code) {
    log.warn({ err: new InvalidMagicLinkError('missing code') }, 'callback_missing_code')
    return htmlRedirect(buildLoginUrl('invalid_link'))
  }

  const cookieBag: CookieToSet[] = []
  cookieBag.push(...buildLegacyCookieCleanup(req))

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
    log.warn(
      { err: new InvalidMagicLinkError(error?.message ?? 'no user/session') },
      'callback_exchange_failed',
    )
    return finalize(htmlRedirect(buildLoginUrl('invalid_link')), cookieBag)
  }

  const { user } = exchange

  // Build session cookies manually (workaround supabase/ssr#36).
  const projectRef = extractProjectRef(clientEnv.NEXT_PUBLIC_SUPABASE_URL)
  cookieBag.push(
    ...buildSessionCookies({
      session: exchange.session,
      user: {
        id: user.id,
        email: user.email,
        user_metadata: user.user_metadata as Record<string, unknown> | undefined,
        app_metadata: user.app_metadata as Record<string, unknown> | undefined,
      },
      projectRef,
      domain,
    }),
  )
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
    log.error({ err: syncErr, userId: user.id }, 'user_sync_failed')
    await supabase.auth.signOut().catch(() => {})
    return finalize(
      htmlRedirect(buildLoginUrl('sync', new UserSyncError('user upsert failed'))),
      cookieBag,
    )
  }

  const redirectTarget = resolveNextRedirect(rawNext)

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
