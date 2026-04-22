/**
 * Helpers para construir URLs contra el dev server en tests Playwright.
 *
 * Base URL configurable vía `PLAYWRIGHT_BASE_URL` (default: `http://lvh.me:3000`).
 * `lvh.me` y subdominios resuelven a 127.0.0.1 sin `/etc/hosts` — patrón ya
 * establecido en los smoke tests y en middleware routing. Ver CLAUDE.md.
 */

function getBase(): { scheme: string; host: string; port: string } {
  const raw = process.env.PLAYWRIGHT_BASE_URL ?? 'http://lvh.me:3001'
  const url = new URL(raw)
  return {
    scheme: url.protocol,
    host: url.hostname,
    port: url.port ? `:${url.port}` : '',
  }
}

/** URL absoluta al subdominio de un place. Ej: `placeUrl('e2e-palermo', '/conversations')`. */
export function placeUrl(slug: string, path: string = '/'): string {
  const { scheme, host, port } = getBase()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${scheme}//${slug}.${host}${port}${normalizedPath}`
}

/** URL absoluta al host apex (sin subdominio). Ej: `appUrl('/login')`. */
export function appUrl(path: string = '/'): string {
  const { scheme, host, port } = getBase()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${scheme}//${host}${port}${normalizedPath}`
}

/** URL absoluta al subdominio `app.` (inbox + settings globales de usuario). */
export function appSubdomainUrl(path: string = '/'): string {
  return placeUrl('app', path)
}
