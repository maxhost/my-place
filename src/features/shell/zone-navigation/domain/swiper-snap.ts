import type { ZoneIndex } from './zones'

/**
 * Pure logic del swipe entre zonas (R.2.5). Aislada para tests unit
 * en vitest — el resto del swiper depende de framer-motion + DOM y
 * se valida con Playwright (R.2.5.4).
 *
 * Ver `docs/features/shell/spec.md` § 16.
 */

/**
 * Threshold de drag para snap a la zona vecina, en fracción del
 * ancho del viewport. 40% es el sweet spot de UX mobile (iOS Photos
 * usa ~33%, Twitter tabs ~50%).
 */
export const SNAP_THRESHOLD_FRACTION = 0.4

/**
 * Threshold de velocity (px/s) para snap incluso sin alcanzar
 * `SNAP_THRESHOLD_FRACTION`. Un flick rápido siempre snapea.
 */
export const SNAP_VELOCITY_THRESHOLD = 500

/**
 * TTL del lastVisitedAt cache. Si una zona se visitó hace > 30s, el
 * swiper dispara `router.refresh()` post-snap para garantizar datos
 * frescos. Coordinado con `experimental.staleTimes.dynamic` en
 * `next.config.ts`.
 */
export const ZONE_FRESH_TTL_MS = 30_000

/**
 * Decide la zona destino al terminar un drag.
 *
 * - `dragOffsetX` < 0 = swipe hacia izquierda (avanza a zona N+1).
 * - `dragOffsetX` > 0 = swipe hacia derecha (retrocede a zona N-1).
 * - El target se clampa a `[0, totalZones - 1]` (no wrap-around;
 *   bounce elastic visual lo cubre framer-motion).
 *
 * Snap si: |offset| > viewportWidth × threshold OR |velocity| > velThreshold.
 *
 * En cualquier otro caso, vuelve al `currentIndex` (cancel del swipe).
 */
export function deriveSnapTarget(params: {
  currentIndex: ZoneIndex
  dragOffsetX: number
  velocityX: number
  viewportWidth: number
  totalZones: number
  thresholdFraction?: number
  velocityThreshold?: number
}): ZoneIndex {
  const {
    currentIndex,
    dragOffsetX,
    velocityX,
    viewportWidth,
    totalZones,
    thresholdFraction = SNAP_THRESHOLD_FRACTION,
    velocityThreshold = SNAP_VELOCITY_THRESHOLD,
  } = params

  if (totalZones <= 0 || viewportWidth <= 0) return currentIndex

  const offsetExceedsThreshold = Math.abs(dragOffsetX) > viewportWidth * thresholdFraction
  const velocityExceedsThreshold = Math.abs(velocityX) > velocityThreshold
  if (!offsetExceedsThreshold && !velocityExceedsThreshold) return currentIndex

  // Direction: el drag negativo (←) significa que el contenido se mueve
  // a la izquierda → el user va hacia la zona siguiente (N+1).
  // El velocity sigue la misma convención.
  const direction = dragOffsetX < 0 || velocityX < 0 ? 1 : -1
  const candidate = currentIndex + direction
  const clamped = Math.max(0, Math.min(totalZones - 1, candidate))
  return clamped as ZoneIndex
}

/**
 * Decide si el swiper debe disparar `router.refresh()` post-snap.
 * Refresh solo cuando los datos cacheados de Next pueden estar stale
 * (>= TTL) — evita waste de bandwidth en swipes rápidos.
 */
export function shouldRefreshZone(params: {
  lastVisitedAt: number | undefined
  now: number
  ttlMs?: number
}): boolean {
  const { lastVisitedAt, now, ttlMs = ZONE_FRESH_TTL_MS } = params
  if (lastVisitedAt === undefined) return false
  return now - lastVisitedAt >= ttlMs
}

/**
 * Detecta si un pathname corresponde a una zona root (donde el swiper
 * debe estar activo). Sub-pages (`/conversations/[postSlug]`,
 * `/events/[id]`, etc.) retornan false — el swiper se vuelve
 * pass-through.
 *
 * Es más estricto que `deriveActiveZone`: ese acepta sub-paths bajo
 * `/conversations/...` para resaltar el dot, este solo acepta el path
 * exacto de la zona.
 */
export function isZoneRootPath(pathname: string, zonePaths: ReadonlyArray<string>): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  return zonePaths.some((p) => p === normalized)
}

/**
 * Decide si el chrome del shell (TopBar + SectionDots) debe renderizar
 * en este pathname.
 *
 * - **Zonas root** (`/`, `/conversations`, `/events`): SÍ — chrome es
 *   la navegación primaria entre zonas.
 * - **`/settings/*`**: SÍ — admin necesita el community switcher para
 *   cambiar de place sin perder contexto.
 * - **Sub-pages** (thread detail, /m/, new forms): NO — la page tiene
 *   su propio header (`<ThreadHeaderBar>`, h1 del form, etc.) y el
 *   chrome del shell suma ruido visual sin valor. Saving 80px de
 *   chrome top en thread detail era un compromise documentado en
 *   discussions spec § 21.2 que ahora resolvemos.
 */
export function shouldShowShellChrome(pathname: string, zonePaths: ReadonlyArray<string>): boolean {
  if (isZoneRootPath(pathname, zonePaths)) return true
  const normalized = pathname.replace(/\/+$/, '') || '/'
  if (normalized === '/settings' || normalized.startsWith('/settings/')) return true
  return false
}
