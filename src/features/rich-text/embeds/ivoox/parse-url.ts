/**
 * Parser de URL de Ivoox → `{ externalId }`. Pattern típico:
 *   `www.ivoox.com/<slug>_rf_<id>_1.html`
 *
 * Aceptamos también la variante `_ej_` por compat con embeds viejos
 * (Ivoox cambió su scheme entre versiones del player).
 */

const IVOOX_PATH = /_(?:rf|ej)_(\d+)_1\.html$/

export type ParsedIvoox = { externalId: string }

export function parseIvooxUrl(input: string): ParsedIvoox | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (host !== 'www.ivoox.com' && host !== 'ivoox.com') return null

  const match = url.pathname.match(IVOOX_PATH)
  if (!match || !match[1]) return null
  return { externalId: match[1] }
}
