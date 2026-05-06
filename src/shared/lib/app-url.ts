/**
 * Helpers para construir URLs cross-subdomain del producto.
 *
 * Place vive en un layout multi-subdominio:
 *   - apex (`place.community`) — landing/marketing
 *   - inbox (`app.place.community`) — bandeja del user logueado
 *   - place (`{slug}.place.community`) — cada place miembro
 *
 * Usar SIEMPRE estos helpers para construir URLs hacia esos hosts en vez de
 * concatenar strings (`https://${slug}.${domain}/...`). Concatenar a mano
 * abrió el bug de `%20` en producción cuando un slug llegaba con whitespace
 * y se mandaba al cliente sin sanitizar.
 *
 * Los helpers retornan `URL` (no `string`). `new URL()` valida internamente
 * y rechaza chars inválidos. Los consumers que necesitan string llaman
 * `.toString()` explícitamente — eso fuerza una segunda lectura del valor
 * y hace evidente la conversión en el call site.
 */
import { clientEnv } from '@/shared/config/env'

/**
 * Devuelve `http` si el `appDomain` es un host de desarrollo local
 * (localhost, lvh.me, IPv4 loopback), `https` en cualquier otro caso.
 *
 * `lvh.me` y subdominios resuelven a 127.0.0.1 vía DNS público — lo usamos
 * en dev porque permite compartir cookies entre `lvh.me` y `*.lvh.me`
 * (cosa que Chrome no siempre honra con `Domain=localhost`).
 */
export function isLocalDomain(appDomain: string): boolean {
  const host = appDomain.split(':')[0]?.toLowerCase() ?? ''
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'lvh.me' ||
    host.endsWith('.lvh.me') ||
    /^127\./.test(host)
  )
}

export function protocolFor(appDomain: string): 'http' | 'https' {
  return isLocalDomain(appDomain) ? 'http' : 'https'
}

/**
 * Slug regex: lower-case alfanumérico + guiones. Duplicado intencionalmente
 * de `places/domain/invariants.ts:SLUG_REGEX` porque `shared/lib/` no puede
 * importar de `features/` (boundary CLAUDE.md, enforced por
 * `tests/boundaries.test.ts`). Mantener sincronizado si alguno cambia.
 */
const SLUG_RE = /^[a-z0-9-]+$/

export function assertValidSlug(slug: string): void {
  // Validamos el slug literal — sin trim — porque el whitespace al borde
  // es exactamente el vector del bug `%20` que estos helpers cierran.
  if (!SLUG_RE.test(slug)) {
    throw new Error(`[app-url] slug inválido: ${JSON.stringify(slug)}`)
  }
}

/** URL del inbox: `app.{appDomain}/`. Path opcional. */
export function inboxUrl(path = '/'): URL {
  const domain = clientEnv.NEXT_PUBLIC_APP_DOMAIN
  return new URL(path, `${protocolFor(domain)}://app.${domain}`)
}

/**
 * URL del subdominio de un place. Falla si el slug tiene whitespace o
 * chars inválidos — esa es la red de seguridad que cierra el vector del
 * bug `%20` en producción.
 */
export function placeUrl(slug: string, path = '/'): URL {
  assertValidSlug(slug)
  const domain = clientEnv.NEXT_PUBLIC_APP_DOMAIN
  return new URL(path, `${protocolFor(domain)}://${slug}.${domain}`)
}

/** URL del apex (marketing/landing). */
export function apexUrl(path = '/'): URL {
  const domain = clientEnv.NEXT_PUBLIC_APP_DOMAIN
  return new URL(path, `${protocolFor(domain)}://${domain}`)
}
