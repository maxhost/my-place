import 'server-only'
import { revalidateTag } from 'next/cache'

/**
 * Helpers de invalidación tag-based para los caches `unstable_cache` del
 * slice `tier-memberships`. La query `listAssignmentsByMember` (alimenta el
 * detalle del miembro en `/settings/members/[userId]`) está envuelta en
 * `cache(unstable_cache(...))` con tag granular por `(placeId, userId)`;
 * cada mutation que asigne o remueva tiers de ese miembro llama al helper
 * `revalidateTierAssignmentsCache` para forzar refresh sin esperar al
 * floor de 60s.
 *
 * Patrón: `findInviterPermissions` en `members/server/queries.ts:62` —
 * `React.cache` envuelve `unstable_cache` con tag granular + `revalidate: 60`
 * como safety net si el invalidate se pierde (ej: deploy reset).
 */

export function tierAssignmentsTag(placeId: string, userId: string): string {
  return `tier-assignments:${placeId}:${userId}`
}

/**
 * Invalida el cache de `listAssignmentsByMember(userId, placeId)` (y su
 * alias `findActiveAssignmentsForMember`, que delega).
 *
 * Llamado desde mutations que asignan o remueven tiers de un miembro:
 * `assignTierToMemberAction`, `removeTierAssignmentAction`. Se SUMA a
 * `revalidatePath` existente — el tag-based actualiza el cache cross-request
 * mientras `revalidatePath` invalida el render de la page concreta.
 */
export function revalidateTierAssignmentsCache(placeId: string, userId: string): void {
  revalidateTag(tierAssignmentsTag(placeId, userId))
}
