import 'server-only'

/**
 * Superficie pública server-only del slice `tier-memberships`. Queries
 * Prisma que nunca deben viajar al bundle cliente.
 *
 * Server Components y Server Actions consumen acá; Client Components
 * consumen sólo `public.ts`. Ver
 * `docs/decisions/2026-04-21-flags-subslice-split.md` § "Boundary client
 * vs server".
 */

export {
  findActiveAssignmentsForMember,
  listAssignmentsByMember,
  listAssignmentsByPlace,
} from './server/queries'

export { revalidateTierAssignmentsCache, tierAssignmentsTag } from './server/cache'
