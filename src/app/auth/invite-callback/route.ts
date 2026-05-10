import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { prisma } from '@/db/client'
import { clientEnv } from '@/shared/config/env'
import { createRequestLogger, REQUEST_ID_HEADER } from '@/shared/lib/request-id'
import { InvalidMagicLinkError, UserSyncError } from '@/shared/errors/auth'
import { cookieDomain } from '@/shared/lib/supabase/cookie-domain'
import { buildInboxUrl, deriveDisplayName, resolveSafeNext } from '@/app/auth/callback/helpers'

/**
 * GET /auth/invite-callback?token_hash=...&type=invite|magiclink&next=...
 *
 * Callback dedicado para magic links generados por `auth.admin.generateLink`.
 *
 * Por qué existe (separado del `/auth/callback` PKCE flow): los `action_link`
 * que retorna `admin.generateLink` usan **implicit flow** — el verify de
 * Supabase redirige al `redirect_to` con tokens en `#hash` (fragment), que
 * no se envía al server. En este flow el email NO apunta al `action_link`
 * de Supabase; apunta acá con el `hashed_token` extraído del payload, y
 * nosotros llamamos `verifyOtp` server-side.
 *
 * Steps:
 * 1. Validar `token_hash` no-vacío y `type` ∈ {invite, magiclink}.
 * 2. `verifyOtp({ token_hash, type })` server-side; setea cookies sobre
 *    el `NextResponse` con `domain=<apex>` para cruzar subdominios.
 * 3. Upsert `User` local (sync con `auth.users`).
 * 4. Redirige a `next` validado contra `SAFE_NEXT_PATTERNS`.
 *
 * Ver `docs/gotchas/supabase-magic-link-callback-required.md`.
 */
export async function GET(req: NextRequest) {
  const log = createRequestLogger(req.headers.get(REQUEST_ID_HEADER) ?? 'unknown')
  const url = new URL(req.url)
  const tokenHash = url.searchParams.get('token_hash')
  const rawType = url.searchParams.get('type')
  const rawNext = url.searchParams.get('next')

  if (!tokenHash) {
    log.warn(
      { err: new InvalidMagicLinkError('missing token_hash') },
      'invite_callback_missing_token',
    )
    return redirectToPath('/login?error=invalid_link')
  }

  const type = parseOtpType(rawType)
  if (!type) {
    log.warn(
      { err: new InvalidMagicLinkError('invalid type'), rawType },
      'invite_callback_invalid_type',
    )
    return redirectToPath('/login?error=invalid_link')
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

  const { data: verify, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  })
  if (error || !verify.user) {
    log.warn(
      { err: new InvalidMagicLinkError(error?.message ?? 'no user'), type },
      'invite_callback_verify_failed',
    )
    return redirectToPath('/login?error=invalid_link')
  }

  const { user } = verify
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
    log.error({ err: syncErr, userId: user.id }, 'invite_callback_user_sync_failed')
    await supabase.auth.signOut().catch(() => {})
    response = redirectToPath('/login?error=sync', new UserSyncError('user upsert failed'))
    return response
  }

  log.info({ userId: user.id, type }, 'invite_callback_success')
  return response
}

function parseOtpType(raw: string | null): 'invite' | 'magiclink' | null {
  if (raw === 'invite' || raw === 'magiclink') return raw
  return null
}

function redirectToPath(path: string, _cause?: Error) {
  const url = new URL(path, clientEnv.NEXT_PUBLIC_APP_URL)
  return NextResponse.redirect(url)
}

function fallbackEmail(userId: string): string {
  return `${userId}@noemail.place.local`
}
