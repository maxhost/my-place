import 'server-only'

/**
 * Superficie pública server-only del slice `tiers`. Queries Prisma
 * que nunca deben viajar al bundle cliente.
 *
 * Server Components y Server Actions consumen acá; Client Components
 * consumen sólo `public.ts`. Ver
 * `docs/decisions/2026-04-21-flags-subslice-split.md` § "Boundary
 * client vs server".
 */

export { findTierById, listTiersByPlace } from './server/queries'
export { revalidateTiersCache, tiersByPlaceTag } from './server/cache'
