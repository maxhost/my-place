import 'server-only'
import type { NextRequest, NextResponse } from 'next/server'
import { clientEnv } from '@/shared/config/env'

/**
 * Defensive cleanup de cookies de sesión Supabase residuales (de versiones
 * previas del producto, otros proyectos Supabase, o sesiones zombi).
 *
 * **Por qué:** detectado en producción 2026-05-10 (Safari iOS) — un user
 * tenía `sb-pdifweaajellxzdpbaht-auth-token` (proyecto Supabase ANTERIOR
 * del producto) con `Domain=place.community` que persistía en el browser
 * y confundía el flow de auth del proyecto actual `tkidotchffveygzisxbn`.
 * Más: residuos de PKCE flow incompleto (`*-auth-token-code-verifier`).
 *
 * Solución: al inicio de cada callback, emitimos `Set-Cookie` con
 * `Max-Age=0` para CADA cookie `sb-*-auth-token{,.<n>,-code-verifier}`
 * presente en el request, en TODOS los Domain attrs posibles del apex y
 * subdomain inbox.
 *
 * **NextResponse cookie merge:** si el verifyOtp/exchange posterior setea
 * `Set-Cookie` para el cookie del proyecto ACTUAL con mismo `name+domain+path`,
 * sobrescribe nuestro cleanup en el response. Net: cookie nueva persiste,
 * cookies viejas/de otros proyectos se borran. (Validar que el SDK use
 * `path=/` — Supabase SSR lo hace por default.)
 *
 * **Pattern de cookies cubierto:**
 * - `sb-<projectRef>-auth-token` (no chunked)
 * - `sb-<projectRef>-auth-token.0`, `.1`, ... (chunked cuando session > 4KB)
 * - `sb-<projectRef>-auth-token-code-verifier` (PKCE flow residual)
 *
 * **Domains que limpiamos:**
 * - `Domain=<apex>` — cookies viejas/de otros proyectos en apex
 * - `Domain=app.<apex>` — cookies legacy en subdomain inbox
 * - host-only (sin Domain) — cookies pegadas al host actual sin Domain attr
 *
 * **Idempotencia:** la función no trackea estado. El caller debe invocarla
 * una vez por request al inicio del handler.
 *
 * Ver ADR `2026-05-10-auth-callbacks-on-apex.md`.
 */
export function cleanupLegacyCookies(req: NextRequest, response: NextResponse): void {
  const apex = clientEnv.NEXT_PUBLIC_APP_DOMAIN.split(':')[0] ?? ''
  const domainsToClean = [apex, `app.${apex}`]

  for (const cookie of req.cookies.getAll()) {
    if (!isSupabaseAuthCookie(cookie.name)) continue

    for (const domain of domainsToClean) {
      response.cookies.set(cookie.name, '', {
        domain,
        path: '/',
        maxAge: 0,
      })
    }

    // Host-only (sin Domain) — para cookies pegadas al host sin Domain attr.
    response.cookies.set(cookie.name, '', {
      path: '/',
      maxAge: 0,
    })
  }
}

// Pattern: `sb-<projectRef>-auth-token` opcional con `.<n>` (chunked) o
// `-code-verifier` (PKCE residual).
const SUPABASE_AUTH_COOKIE_RE = /^sb-[A-Za-z0-9]+-auth-token(\.\d+|-code-verifier)?$/

function isSupabaseAuthCookie(name: string): boolean {
  return SUPABASE_AUTH_COOKIE_RE.test(name)
}
