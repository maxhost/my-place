import { type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { revalidatePath } from 'next/cache'
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
import { apexUrl, placeUrl } from '@/shared/lib/app-url'
import { isDomainError } from '@/shared/errors/domain-error'
import { deriveDisplayName } from '@/app/auth/callback/helpers'
import { acceptInvitationCore, revalidateMemberPermissions } from '@/features/members/public.server'

/**
 * GET /auth/invite-callback?token_hash=...&type=invite|magiclink&next=...
 *
 * Callback dedicado para magic links generados por `auth.admin.generateLink`.
 *
 * **Patrón de cookies:** acumulamos todas las cookies a setear en un "bag"
 * (cleanup defensivo + cookies de verifyOtp/setSession via cookies adapter
 * de @supabase/ssr) y las aplicamos al response FINAL en cualquier path
 * (happy / verify error / sync error). Sin esto, los paths de error pierden
 * el cleanup porque retornan un response distinto.
 *
 * **`htmlRedirect` (200 OK + meta refresh)** en vez de `NextResponse.redirect`:
 * Safari iOS descarta `Set-Cookie` en respuestas a redirects. Documentado
 * en vercel/next.js#48434. Confirmado empíricamente con test endpoint.
 *
 * **`setSession` post-verifyOtp:** workaround para supabase/ssr#36 — verifyOtp
 * escribe la session via `onAuthStateChange` listener async. `setSession()`
 * fuerza la escritura síncrona del cookies adapter.
 */
export async function GET(req: NextRequest) {
  const log = createRequestLogger(req.headers.get(REQUEST_ID_HEADER) ?? 'unknown')
  const url = new URL(req.url)
  const tokenHash = url.searchParams.get('token_hash')
  const rawType = url.searchParams.get('type')
  const rawNext = url.searchParams.get('next')

  // DEBUG TEMPORAL — traceId único que propaga al next URL para correlacionar logs end-to-end.
  const traceId = Math.random().toString(36).substring(2, 10)
  const incomingSb = req.cookies
    .getAll()
    .filter((c) => /^sb-/.test(c.name))
    .map((c) => c.name)
    .join(',')
  log.warn(
    {
      debug: 'IC_entry',
      traceId,
      host: req.headers.get('host'),
      tokenHashLen: tokenHash?.length ?? 0,
      rawType,
      rawNext,
      incomingSb,
      ua: req.headers.get('user-agent'),
    },
    `DBG IC[entry] tr=${traceId} host=${req.headers.get('host')} tokenLen=${tokenHash?.length ?? 0} type=${rawType} next=${rawNext} sb=[${incomingSb}]`,
  )

  if (!tokenHash) {
    log.warn(
      { err: new InvalidMagicLinkError('missing token_hash'), traceId },
      `DBG IC[fail-no-token] tr=${traceId}`,
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

  // Acumulamos cookies a setear en el response final (sea cual sea).
  const cookieBag: CookieToSet[] = []
  const projectRef = extractProjectRef(clientEnv.NEXT_PUBLIC_SUPABASE_URL)
  // Cleanup excluyendo cookies del proyecto actual (la session nueva las
  // sobrescribe naturalmente; emitir cleanup + nueva con mismo name+domain
  // hace que Safari iOS borre la nueva).
  cookieBag.push(...buildLegacyCookieCleanup(req, { currentProjectRef: projectRef }))

  const domain = cookieDomain(clientEnv.NEXT_PUBLIC_APP_DOMAIN)
  // SDK setAll escribe al bag — refresh_token solo es válido cuando lo
  // serializa el SDK con su formato exacto (buildSessionCookies manual
  // produce cookies que el SDK puede deserializar pero NO funcionan para
  // refresh: Supabase devuelve "refresh_token_not_found" porque algún
  // metadata interno del SDK falta).
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

  const { data: verify, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  })
  log.warn(
    {
      debug: 'IC_verify_done',
      traceId,
      hasUser: !!verify?.user,
      hasSession: !!verify?.session,
      userId: verify?.user?.id ?? null,
      errorMessage: error?.message ?? null,
      errorCode: (error as { code?: string } | null)?.code ?? null,
    },
    `DBG IC[verify] tr=${traceId} user=${verify?.user?.id ?? 'null'} sess=${!!verify?.session} err=${error?.message ?? '-'}`,
  )
  if (error || !verify.user || !verify.session) {
    log.warn(
      { err: new InvalidMagicLinkError(error?.message ?? 'no user/session'), type, traceId },
      'invite_callback_verify_failed',
    )
    return finalize(htmlRedirect(buildLoginUrl('invalid_link')), cookieBag)
  }

  const { user } = verify

  // Drain microtasks para que `onAuthStateChange` listener interno del SDK
  // ssr corra → invoque applyServerStorage → invoque setAll de nuestro
  // cookies adapter → push a cookieBag con session cookies CORRECTAS
  // (refresh_token persistido server-side).
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
    log.error({ err: syncErr, userId: user.id }, 'invite_callback_user_sync_failed')
    await supabase.auth.signOut().catch(() => {})
    return finalize(
      htmlRedirect(buildLoginUrl('sync', new UserSyncError('user upsert failed'))),
      cookieBag,
    )
  }

  // **Accept inline (T2):** si `next` es `/invite/accept/<token>`, intentamos
  // ejecutar el accept ACÁ para que el user llegue directo al place sin pasar
  // por la PÁGINA 2 ("Aceptar y entrar"). Manejamos errores recuperables
  // redirigiendo al fallback de la accept page con `?error=<reason>`.
  // Plan: docs/plans/2026-05-10-invite-callback-direct-accept.md
  const inviteToken = extractInviteToken(rawNext)
  let redirectTarget: URL
  if (inviteToken) {
    try {
      const acceptResult = await acceptInvitationCore(inviteToken, user.id)
      // Cache invalidation (mismo set que `acceptInvitationAction`).
      revalidatePath('/inbox')
      revalidatePath(`/${acceptResult.placeSlug}`)
      revalidatePath(`/${acceptResult.placeSlug}`, 'layout')
      revalidateMemberPermissions(user.id, acceptResult.placeId)
      redirectTarget = placeUrl(acceptResult.placeSlug)
      log.info(
        {
          event: 'invite_callback_accept_inline',
          userId: user.id,
          placeSlug: acceptResult.placeSlug,
          alreadyMember: acceptResult.alreadyMember,
          traceId,
        },
        'invite accepted inline in callback',
      )
    } catch (acceptErr) {
      // Fallback: redirigir a la accept page con el error como query param.
      // La page maneja el render del mensaje (ya tiene `<InvitationProblem>`).
      const reason = acceptErrorToReason(acceptErr)
      log.warn(
        {
          event: 'invite_callback_accept_failed',
          err: acceptErr,
          reason,
          userId: user.id,
          inviteToken,
          traceId,
        },
        'invite accept inline failed — redirecting to accept page fallback',
      )
      const fallback = apexUrl(`/invite/accept/${encodeURIComponent(inviteToken)}`)
      fallback.searchParams.set('error', reason)
      redirectTarget = fallback
    }
  } else {
    redirectTarget = resolveNextRedirect(rawNext)
  }
  redirectTarget.searchParams.set('_t', traceId)

  log.warn(
    {
      debug: 'IC_response_built',
      traceId,
      userId: user.id,
      redirectTarget: redirectTarget.toString(),
      bagSize: cookieBag.length,
      bagNames: cookieBag.map((c) => `${c.name}|d=${c.options.domain ?? '-'}|v=${c.value.length}`),
    },
    `DBG IC[response] tr=${traceId} target=${redirectTarget.toString()} bag=${cookieBag.length}`,
  )

  log.info({ userId: user.id, type, traceId }, 'invite_callback_success')
  return finalize(htmlRedirect(redirectTarget), cookieBag)
}

/**
 * Extrae el token de invitación de `next=/invite/accept/<token>`. Retorna
 * `null` si `next` no matchéa el patrón. Token shape (de `acceptInvitationTokenSchema`):
 * 1-512 chars, alfanuméricos + `_` + `-`.
 */
function extractInviteToken(rawNext: string | null): string | null {
  if (!rawNext) return null
  const match = rawNext.match(/^\/invite\/accept\/([A-Za-z0-9_-]{1,512})\/?$/)
  return match?.[1] ?? null
}

/**
 * Mapea errores typed de `acceptInvitationCore` a un reason corto que la
 * accept page (`/invite/accept/[token]`) puede leer del query y mostrar.
 * Reasons matchean los `kind` de `<InvitationProblem>` + extras del core.
 */
function acceptErrorToReason(err: unknown): string {
  if (!isDomainError(err)) return 'unknown'
  const ctx = err.context as { reason?: string } | undefined
  if (ctx?.reason) return ctx.reason
  if (err.code === 'NOT_FOUND') return 'not_found'
  if (err.code === 'VALIDATION') return 'invalid'
  if (err.code === 'CONFLICT') return 'conflict'
  if (err.code === 'INVARIANT_VIOLATION') return 'invariant'
  return 'unknown'
}

/** Apply cookie bag al response final + retornar. */
function finalize(response: ReturnType<typeof htmlRedirect>, bag: CookieToSet[]) {
  applyCookies(response, bag)
  // DEBUG TEMPORAL — bag info en headers para verificar vía curl.
  response.headers.set('x-debug-bag-size', String(bag.length))
  response.headers.set(
    'x-debug-bag-names',
    bag.map((c) => `${c.name}|d=${c.options.domain ?? '-'}|v=${c.value.length}`).join(','),
  )
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
