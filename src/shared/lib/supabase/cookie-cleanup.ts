import 'server-only'
import type { NextRequest, NextResponse } from 'next/server'
import { clientEnv } from '@/shared/config/env'

export type CookieToSet = {
  name: string
  value: string
  options: {
    domain?: string
    path?: string
    maxAge?: number
    httpOnly?: boolean
    secure?: boolean
    sameSite?: 'lax' | 'strict' | 'none' | boolean
    expires?: Date
  }
}

const SUPABASE_AUTH_COOKIE_RE = /^sb-[A-Za-z0-9]+-auth-token(\.\d+|-code-verifier)?$/

function isSupabaseAuthCookie(name: string): boolean {
  return SUPABASE_AUTH_COOKIE_RE.test(name)
}

/**
 * Defensive cleanup de cookies de sesión Supabase residuales — devuelve
 * un array de cookies a setear con `Max-Age=0` para invalidar las viejas.
 *
 * **Por qué un array (cookie bag) en vez de mutar response:** el callback
 * puede retornar distintos `NextResponse` según el path (happy / fail /
 * sync error). Si mutamos un response que después se descarta, el cleanup
 * se pierde. Devolver un array permite al caller aplicarlo al response
 * FINAL que efectivamente se retorna.
 *
 * **Pattern de cookies cubierto:** `sb-<projectRef>-auth-token` +
 * `.<n>` chunked + `-code-verifier` PKCE residual.
 *
 * **Domains que limpiamos** (Safari iOS solo acepta los que matchean el
 * host actual o ancestor — `Domain=app.<apex>` desde `www.<apex>` es
 * rechazado silenciosamente, RFC 6265):
 * - `Domain=<apex>` ✓ aplica al apex y todos los subdomains
 * - host-only (sin Domain) ✓ aplica al host actual
 * - `Domain=app.<apex>` — emitido SOLO si el caller corre en app.<apex> o
 *   subdomain (sino Safari rechaza). Lo seguimos emitiendo defensivamente
 *   porque NO causa daño (browsers que no coinciden lo ignoran sin error).
 */
export function buildLegacyCookieCleanup(req: NextRequest): CookieToSet[] {
  const apex = clientEnv.NEXT_PUBLIC_APP_DOMAIN.split(':')[0] ?? ''
  const domainsToClean = [apex, `app.${apex}`]
  const out: CookieToSet[] = []

  for (const cookie of req.cookies.getAll()) {
    if (!isSupabaseAuthCookie(cookie.name)) continue
    for (const domain of domainsToClean) {
      out.push({ name: cookie.name, value: '', options: { domain, path: '/', maxAge: 0 } })
    }
    out.push({ name: cookie.name, value: '', options: { path: '/', maxAge: 0 } })
  }
  return out
}

/**
 * Backward-compat: aplica el cleanup directamente a un response (mismo
 * comportamiento que la versión previa).
 *
 * @deprecated Usar `buildLegacyCookieCleanup(req)` y aplicar al response
 * final del handler para que el cleanup sobreviva en todos los paths.
 */
export function cleanupLegacyCookies(req: NextRequest, response: NextResponse): void {
  for (const c of buildLegacyCookieCleanup(req)) {
    response.cookies.set(c.name, c.value, c.options)
  }
}

/**
 * Aplica un array de cookies a un response.
 *
 * **Importante:** usa `headers.append('Set-Cookie', ...)` directamente en
 * vez de `response.cookies.set()`. La API `.cookies.set()` deduplica por
 * nombre — si emitís 3 Set-Cookie con el mismo nombre y distintos Domain
 * (caso típico del cleanup defensivo), solo el último persiste. Append a
 * raw header garantiza los 3 headers separados.
 */
export function applyCookies(response: NextResponse, cookies: CookieToSet[]): void {
  for (const c of cookies) {
    response.headers.append('Set-Cookie', serializeCookie(c))
  }
}

function serializeCookie(c: CookieToSet): string {
  const parts: string[] = [`${c.name}=${encodeURIComponent(c.value)}`]
  const o = c.options
  if (o.domain) parts.push(`Domain=${o.domain}`)
  if (o.path) parts.push(`Path=${o.path}`)
  if (o.maxAge !== undefined) parts.push(`Max-Age=${o.maxAge}`)
  if (o.expires) parts.push(`Expires=${o.expires.toUTCString()}`)
  if (o.httpOnly) parts.push('HttpOnly')
  if (o.secure) parts.push('Secure')
  if (o.sameSite) {
    const v = typeof o.sameSite === 'string' ? o.sameSite : o.sameSite ? 'Strict' : ''
    if (v) parts.push(`SameSite=${capitalize(v)}`)
  }
  return parts.join('; ')
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}
