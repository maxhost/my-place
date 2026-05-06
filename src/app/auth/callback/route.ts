import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { prisma } from '@/db/client'
import { clientEnv } from '@/shared/config/env'
import { createRequestLogger, REQUEST_ID_HEADER } from '@/shared/lib/request-id'
import { InvalidMagicLinkError, UserSyncError } from '@/shared/errors/auth'
import { cookieDomain } from '@/shared/lib/supabase/cookie-domain'
import { buildInboxUrl, deriveDisplayName, resolveSafeNext } from './helpers'

/**
 * GET /auth/callback?code=...&next=...
 *
 * 1. Intercambia el `code` por sesión Supabase.
 * 2. Upsert `User` local (sync con `auth.users`).
 * 3. Redirige a `next` validado o al inbox por default.
 *
 * Las cookies de sesión se escriben DIRECTAMENTE sobre el `NextResponse`
 * devuelto, con `domain=<apex>` para cruzar subdominios. Escribirlas vía
 * `cookies().set()` en un Route Handler no garantiza que lleguen al redirect.
 *
 * Ver `docs/features/auth/spec.md`.
 */
export async function GET(req: NextRequest) {
  const log = createRequestLogger(req.headers.get(REQUEST_ID_HEADER) ?? 'unknown')
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const rawNext = url.searchParams.get('next')

  if (!code) {
    log.warn({ err: new InvalidMagicLinkError('missing code') }, 'callback_missing_code')
    return redirectTo('/login?error=invalid_link')
  }

  const redirectTarget = resolveSafeNext(rawNext, buildInboxUrl())
  let response = NextResponse.redirect(redirectTarget)
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
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, { ...options, ...(domain ? { domain } : {}) })
          }
        },
      },
    },
  )

  const { data: exchange, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !exchange.user) {
    log.warn(
      { err: new InvalidMagicLinkError(error?.message ?? 'no user') },
      'callback_exchange_failed',
    )
    return redirectTo('/login?error=invalid_link')
  }

  const { user } = exchange
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
    response = redirectTo('/login?error=sync', new UserSyncError('user upsert failed'))
    return response
  }

  log.info({ userId: user.id }, 'callback_success')
  return response
}

function redirectTo(path: string, _cause?: Error) {
  const url = new URL(path, clientEnv.NEXT_PUBLIC_APP_URL)
  return NextResponse.redirect(url)
}

function fallbackEmail(userId: string): string {
  return `${userId}@noemail.place.local`
}
