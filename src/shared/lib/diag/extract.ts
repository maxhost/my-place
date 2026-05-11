/**
 * Helpers puros para extraer contexto de un NextRequest sin disparar I/O.
 * Aislados para testing fácil sin mockear Prisma ni next/headers.
 *
 * Ver `src/shared/lib/diag/log.ts` para el wiring final.
 */

export function truncateIp(raw: string | null | undefined): string | null {
  if (!raw) return null
  // X-Forwarded-For puede ser "client, proxy1, proxy2" — el cliente real es el primero.
  const first = raw.split(',')[0]?.trim()
  if (!first) return null
  // IPv4: dejar primeros 3 octetos.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(first)
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.x`
  // IPv6: dejar primeros 4 grupos.
  if (first.includes(':')) {
    const parts = first.split(':').filter((p) => p !== '')
    if (parts.length >= 4) return `${parts.slice(0, 4).join(':')}::`
    return `${first}::`
  }
  return first
}

export function extractCookieNames(
  cookies: ReadonlyArray<{ name: string }>,
  pattern: RegExp = /^sb-/,
): string[] {
  return cookies.filter((c) => pattern.test(c.name)).map((c) => c.name)
}

export function truncateString(s: string | null | undefined, max: number): string | null {
  if (!s) return null
  return s.length > max ? `${s.slice(0, max)}…(${s.length})` : s
}
