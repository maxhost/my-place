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
