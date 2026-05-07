import 'server-only'
import { revalidateTag } from 'next/cache'

/**
 * Helpers de invalidación tag-based para el cache `unstable_cache` de
 * `listTiersByPlace`. Mismo patrón que `places/server/cache.ts` (Sesión 5)
 * y `findInviterPermissions` (`members/server/queries.ts`).
 *
 * `React.cache` envuelve `unstable_cache` con tag granular + `revalidate: 60`
 * como safety net si el invalidate se pierde (ej: deploy reset).
 */

export function tiersByPlaceTag(placeId: string): string {
  return `tiers:${placeId}`
}

/**
 * Invalida el cache de `listTiersByPlace(placeId, …)` para todas las shapes
 * (owner / non-owner). Llamado desde mutations sobre `Tier` —
 * `createTierAction`, `updateTierAction`, `setTierVisibilityAction`.
 */
export function revalidateTiersCache(placeId: string): void {
  revalidateTag(tiersByPlaceTag(placeId))
}
