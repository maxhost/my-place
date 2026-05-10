import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/db/client'
import { clientEnv } from '@/shared/config/env'
import { createRequestLogger, REQUEST_ID_HEADER } from '@/shared/lib/request-id'
import { InvalidMagicLinkError, UserSyncError } from '@/shared/errors/auth'
import { createSupabaseServer } from '@/shared/lib/supabase/server'
import { cleanupLegacyCookies } from '@/shared/lib/supabase/cookie-cleanup'
import { resolveNextRedirect } from '@/shared/lib/next-redirect'
import { deriveDisplayName } from '@/app/auth/callback/helpers'

/**
 * GET /auth/invite-callback?token_hash=...&type=invite|magiclink&next=...
 *
 * Callback dedicado para magic links generados por `auth.admin.generateLink`.
 * Vive en APEX (no subdomain) — ver ADR `2026-05-10-auth-callbacks-on-apex.md`.
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
 * 2. Cleanup defensivo de cookies legacy (`Domain=app.<apex>`, host-only)
 *    para users con sesiones residuales pre-2026-05-10.
 * 3. `verifyOtp({ token_hash, type })` server-side via `createSupabaseServer()`
 *    (usa `cookies()` de next/headers — patrón canónico Next 15 + Supabase
 *    SSR; setea cookies con `Domain=<apex>` para cruzar subdomains).
 * 4. Upsert `User` local (sync con `auth.users`).
 * 5. Redirige a `next` resuelto via `resolveNextRedirect` (host-aware:
 *    `/invite/accept/<tok>` → apex; `/<slug>/conversations` → place
 *    subdomain; `/inbox` → inbox subdomain).
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

  const redirectTarget = resolveNextRedirect(rawNext)
  let response = NextResponse.redirect(redirectTarget)
  cleanupLegacyCookies(req, response)

  const supabase = await createSupabaseServer()

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

  // DEBUG TEMPORAL 2026-05-10 — diagnosticar cookies en mobile post-S2.
  // Reportado: incógnito desktop OK, mobile con state previo cae a /login.
  // Hipótesis: cookie nueva no llega al browser o se mezcla con vieja.
  log.warn(
    {
      debug: 'invite_callback_response_cookies',
      userId: user.id,
      host: req.headers.get('host'),
      incomingCookieNames: req.cookies.getAll().map((c) => c.name),
      responseCookieNames: response.cookies.getAll().map((c) => c.name),
      responseCookieDetails: response.cookies.getAll().map((c) => ({
        name: c.name,
        hasValue: !!c.value,
        valueLen: c.value?.length ?? 0,
        domain: (c as { domain?: string }).domain ?? null,
        path: (c as { path?: string }).path ?? null,
        sameSite: (c as { sameSite?: string }).sameSite ?? null,
        secure: (c as { secure?: boolean }).secure ?? null,
        httpOnly: (c as { httpOnly?: boolean }).httpOnly ?? null,
        maxAge: (c as { maxAge?: number }).maxAge ?? null,
      })),
      redirectLocation: response.headers.get('location'),
    },
    'DEBUG invite_callback final response',
  )

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
