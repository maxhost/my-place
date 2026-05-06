import 'server-only'
import { revalidateTag } from 'next/cache'

/**
 * API server-only del slice `members`. Queries Prisma + componentes
 * que las consumen + jobs (erasure 365d). Solo importable desde
 * Server Components, Server Actions, Route Handlers o background tasks.
 *
 * Mismo patrón split que `flags/public.server.ts` (ADR
 * `2026-04-21-flags-subslice-split.md`). Pages y layouts que necesitan
 * estos exports importan desde `@/features/members/public.server`;
 * todo lo client-safe vive en `public.ts`.
 */

/**
 * Invalida el cache cross-request de `findMemberPermissions` para un viewer
 * en un place específico. Llamar desde server actions que muten
 * `Membership` / `PlaceOwnership` / `GroupMembership` (todo lo que afecta
 * `isMember`, `isOwner` o `isAdmin`).
 *
 * Implementado en plan #2.3: `findInviterPermissions` se cachea con
 * `unstable_cache` taggeado `perms:${userId}:${placeId}`. Sin esta
 * invalidación, un user que recién acepta una invitación o sale del place
 * vería el resultado cacheado por 60s.
 */
export function revalidateMemberPermissions(userId: string, placeId: string): void {
  revalidateTag(`perms:${userId}:${placeId}`)
}

// Queries (server-only)
export {
  findInvitationById,
  findInvitationByToken,
  findInviterPermissions as findMemberPermissions,
  findMemberProfile,
  listActiveMembers,
  listPendingInvitationsByPlace,
  type ActiveMember,
  type InvitationWithDelivery,
  type InvitationWithPlace,
  type MemberProfile,
} from './server/queries'

// Directory queries (server-only) — sub-slice members/directory/
export {
  findMemberBlockInfo,
  findMemberDetailForOwner,
  searchMembers,
  type MemberBlockInfo,
  type MemberDetail,
  type MemberSummary,
} from './directory/server/directory-queries'

// Permissions helper (server-only)
export { hasPermission } from './server/permissions'

// Server-only UI (consume queries internamente)
export { PendingInvitationsList } from './ui/pending-invitations-list'

// Background jobs (cron, etc.)
export { runErasure } from './server/erasure/run-erasure'
export type { ErasureRunResult } from './server/erasure/types'
