import 'server-only'

/**
 * Superficie pública server-only del slice `groups` (G.2). Queries Prisma
 * que nunca deben viajar al bundle cliente.
 *
 * Server Components y Server Actions consumen acá; Client Components
 * consumen sólo `public.ts`. Ver
 * `docs/decisions/2026-04-21-flags-subslice-split.md` § "Boundary client
 * vs server".
 *
 * `hasPermission` y `listAllowedCategoryIds` viven en
 * `members/server/permissions.ts` (no acá) porque se componen con
 * `findPlaceOwnership` y `findActiveMembership` — primitivas de identity
 * que ya viven en members.
 *
 * Refactor mayo 2026: `<GroupsListAdmin>` migró a Client Component (vive
 * en `public.ts`) cuando la lista pasó a row-as-Link minimalista. La
 * superficie server-only quedó sólo con queries.
 */

export {
  findGroupById,
  listGroupsByPlace,
  listGroupsForUser,
  listMembershipsByGroup,
  listMembershipsByGroupIds,
} from './server/queries'
