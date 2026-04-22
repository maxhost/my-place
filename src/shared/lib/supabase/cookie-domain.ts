/**
 * Deriva el atributo `domain` para las cookies de sesión a partir del app domain.
 * Necesario para que la sesión Supabase cruce entre el apex y los subdominios
 * (`place.app` ↔ `app.place.app` ↔ `{slug}.place.app`, y su análogo en dev con `*.lvh.me`).
 *
 * Reglas:
 *  - Strip del puerto (las cookies no lo llevan).
 *  - `localhost` → `localhost`, aunque Chrome NO siempre propaga `Domain=localhost` a
 *    `*.localhost`; en dev usamos `lvh.me` (resuelve a 127.0.0.1 vía DNS público) para
 *    evitar esa limitación.
 *  - IPv4 numérica → sin `domain` (el browser rechaza cookies con domain sobre IP).
 *  - Cualquier hostname FQDN → se usa tal cual (sin leading dot; RFC 6265 lo ignora).
 */
export function cookieDomain(appDomain: string): string | undefined {
  const host = appDomain.split(':')[0]?.trim().toLowerCase()
  if (!host) return undefined
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return undefined
  return host
}
