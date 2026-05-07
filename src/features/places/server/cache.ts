import 'server-only'
import { revalidateTag } from 'next/cache'
import { placeByIdTag, placeBySlugTag } from '@/shared/lib/place-loader'

/**
 * Helpers de invalidación tag-based para los caches `unstable_cache` del
 * slice `places`. Cada query cacheada (en `place-loader.ts` para
 * `loadPlaceBySlug`/`loadPlaceById`, y en `queries.ts` para `listMyPlaces`)
 * declara el tag correspondiente; cada mutation que afecte ese dato llama al
 * helper `revalidate*Cache` para forzar refresh sin esperar al floor de 60s.
 *
 * Patrón: `findInviterPermissions` en `members/server/queries.ts:62` —
 * `React.cache` envuelve `unstable_cache` con tag granular + `revalidate: 60`
 * como safety net si el invalidate se pierde (ej: deploy reset).
 *
 * Los tag builders `placeBySlugTag` / `placeByIdTag` viven en
 * `shared/lib/place-loader.ts` (el cache vive ahí); `myPlacesTag` vive acá
 * porque pertenece al slice. Boundary: `shared/` no importa de `features/`,
 * pero `features/` puede importar de `shared/`.
 */

export { placeBySlugTag, placeByIdTag }

export function myPlacesTag(userId: string): string {
  return `my-places:${userId}`
}

/**
 * Invalida los caches de `loadPlaceBySlug(slug)` y `loadPlaceById(id)` —
 * tags separados porque el caller puede no tener ambos identificadores
 * al momento de la mutation.
 *
 * Llamado desde mutations sobre `Place` (archive, transfer ownership,
 * update theme/hours/editor-config). NO se llama en `create`: el slug
 * recién creado no estaba en cache.
 */
export function revalidatePlaceCache(slug: string, id: string): void {
  revalidateTag(placeBySlugTag(slug))
  revalidateTag(placeByIdTag(id))
}

/**
 * Invalida `listMyPlaces(userId, opts)` para un usuario. Llamado por:
 *  - `members/server/actions/{accept,leave}.ts` — cambia membership.
 *  - `members/moderation/server/actions/{block,unblock,expel}-member.ts`
 *  - `places/server/actions.ts` — `createPlaceTx` (creator), `archivePlaceAction`
 *    (loop por todos los miembros activos), `performTransferTx` (nuevo owner +
 *    actor saliente si removeActor).
 */
export function revalidateMyPlacesCache(userId: string): void {
  revalidateTag(myPlacesTag(userId))
}
