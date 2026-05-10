import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { prisma } from '@/db/client'
import { clientEnv } from '@/shared/config/env'
import { createRequestLogger, REQUEST_ID_HEADER } from '@/shared/lib/request-id'
import { InvalidMagicLinkError, UserSyncError } from '@/shared/errors/auth'
import { cookieDomain } from '@/shared/lib/supabase/cookie-domain'
import { cleanupLegacyCookies } from '@/shared/lib/supabase/cookie-cleanup'
import { resolveNextRedirect } from '@/shared/lib/next-redirect'
import { htmlRedirect } from '@/shared/lib/auth-redirect-html'
import { deriveDisplayName } from '@/app/auth/callback/helpers'

/**
 * GET /auth/invite-callback?token_hash=...&type=invite|magiclink&next=...
 *
 * Callback dedicado para magic links generados por `auth.admin.generateLink`.
 *
 * **Patrón de cookies (importante):** usamos `createServerClient` directo (NO
 * `createSupabaseServer()`) con un `cookies` adapter que escribe DIRECTAMENTE
 * en `response.cookies.set()`. Razón: cuando un route handler retorna su
 * propio `NextResponse`, las cookies escritas via `cookies()` de
 * `next/headers` (que es lo que `createSupabaseServer` usa) NO se mergean
 * al response final. Las cookies tienen que ir explícitamente en el
 * `response.cookies` que retornamos.
 *
 * **`setSession` post-verifyOtp:** workaround para supabase/ssr#36 — verifyOtp
 * escribe la session via `onAuthStateChange` listener async, que puede no
 * ejecutarse antes del return. `setSession()` fuerza la escritura síncrona
 * del cookies adapter (vía `setItem` interno → invoca `setAll` antes del
 * await retorne).
 *
 * **`htmlRedirect` (200 OK + meta refresh)** en vez de `NextResponse.redirect`:
 * Safari iOS ITP descarta `Set-Cookie` en respuestas a redirects (307/303).
 * Documentado en vercel/next.js#48434.
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
    return htmlRedirect(buildLoginUrl('invalid_link'))
  }

  const type = parseOtpType(rawType)
  if (!type) {
    log.warn(
      { err: new InvalidMagicLinkError('invalid type'), rawType },
      'invite_callback_invalid_type',
    )
    return htmlRedirect(buildLoginUrl('invalid_link'))
  }

  const redirectTarget = resolveNextRedirect(rawNext)
  const response = htmlRedirect(redirectTarget)
  cleanupLegacyCookies(req, response)

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
  if (error || !verify.user || !verify.session) {
    log.warn(
      { err: new InvalidMagicLinkError(error?.message ?? 'no user/session'), type },
      'invite_callback_verify_failed',
    )
    return htmlRedirect(buildLoginUrl('invalid_link'))
  }

  // Fuerza escritura síncrona del cookies adapter (workaround supabase/ssr#36).
  await supabase.auth.setSession({
    access_token: verify.session.access_token,
    refresh_token: verify.session.refresh_token,
  })

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
    return htmlRedirect(buildLoginUrl('sync', new UserSyncError('user upsert failed')))
  }

  // DEBUG TEMPORAL — verificar Set-Cookie headers en response final.
  const setCookieHeaders: string[] = []
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') setCookieHeaders.push(value)
  })
  log.warn(
    {
      debug: 'invite_callback_response_set_cookie',
      userId: user.id,
      setCookieCount: setCookieHeaders.length,
      cookieNames: response.cookies.getAll().map((c) => c.name),
    },
    `DBG SetCookie count=${setCookieHeaders.length} cookies=[${response.cookies
      .getAll()
      .map((c) => `${c.name}(${c.value.length})`)
      .join(',')}]`,
  )

  log.info({ userId: user.id, type }, 'invite_callback_success')
  return response
}

function parseOtpType(raw: string | null): 'invite' | 'magiclink' | null {
  if (raw === 'invite' || raw === 'magiclink') return raw
  return null
}

function buildLoginUrl(error: 'invalid_link' | 'sync', _cause?: Error): URL {
  return new URL(`/login?error=${error}`, clientEnv.NEXT_PUBLIC_APP_URL)
}

function fallbackEmail(userId: string): string {
  return `${userId}@noemail.place.local`
}

// Suppress unused import warning for NextResponse (used implicitly via htmlRedirect).
void NextResponse
