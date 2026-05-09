/**
 * Detección de origen para botones "Volver" en pages de detalle.
 *
 * **Por qué query param y no `document.referrer`/history:** el approach
 * por query param es server-first, robusto a refresh, sin browser API,
 * y deterministic — encaja con "Server Components por default" de
 * `CLAUDE.md`. Las cards del listado linkean al detalle con `?from=…`
 * y la page lo lee SSR para computar `backHref`. Si el query param
 * falta (deep link, mention sin `from`, link externo) cae al
 * `defaultHref` que el caller decida.
 *
 * Las URLs son **paths sin `placeSlug`** — el slug ya vive en el host
 * (subdomain) y el router de Next mete el placeSlug automático en
 * cualquier `<Link>` o `router.push` desde una page del slice
 * `[placeSlug]/`. Ver `MEMORY.md § feedback_urls_subdomain.md`.
 *
 * Decisión: `docs/decisions/2026-05-09-back-navigation-origin.md`.
 */

/** Zonas válidas de origen — discriminador para resolver el back href. */
export const ORIGIN_ZONES = ['conversations', 'events', 'library'] as const

export type OriginZone = (typeof ORIGIN_ZONES)[number]

/**
 * Parser defensivo para `?from=…`. Devuelve la zona si matchea, o
 * `null` si el valor es desconocido/ausente. Nunca throwea — entradas
 * inválidas son tratadas como "sin origen" para que el caller use su
 * `defaultHref`.
 */
export function parseOriginZone(raw: string | undefined | null): OriginZone | null {
  if (typeof raw !== 'string') return null
  return (ORIGIN_ZONES as ReadonlyArray<string>).includes(raw) ? (raw as OriginZone) : null
}

/**
 * URL canónica de cada zona — la que usaría un back button por default.
 */
export const ORIGIN_ZONE_HREF: Record<OriginZone, string> = {
  conversations: '/conversations',
  events: '/events',
  library: '/library',
}

/**
 * Construye un querystring `?from=<zone>` para anexar a un href de
 * detalle. Devuelve `''` si la zona es null (no hay origen para
 * propagar). Usa `URLSearchParams` para escape correcto, aunque para
 * los valores válidos del enum no haga falta.
 */
export function originQuery(zone: OriginZone | null): string {
  if (zone === null) return ''
  const params = new URLSearchParams({ from: zone })
  return `?${params.toString()}`
}
