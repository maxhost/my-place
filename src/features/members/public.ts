/**
 * API pública client-safe del slice `members`. Tipos, schemas Zod,
 * Server Actions (callables desde Client Components vía RSC boundary)
 * y componentes UI client-safe.
 *
 * **No** incluye queries server-only ni componentes que las usen
 * (ver `public.server.ts`). Mismo patrón split que `flags/public.ts`
 * + `flags/public.server.ts` (ADR `2026-04-21-flags-subslice-split.md`):
 * Next traza re-exports al bundle cliente cuando un Server Component
 * que viaja a un Client Component importa este archivo. Mezclar
 * `import 'server-only'` acá rompería el build.
 *
 * Caso real R.6.3: `<LoadMorePosts>` ('use client') usa `<ThreadRow>`
 * (server) que importa `MemberAvatar` via este barrel. Sin split, el
 * bundle cliente trazaba hasta `<PendingInvitationsList>` (server-only)
 * y rompía con "You're importing a component that needs 'server-only'".
 */

// ---------------------------------------------------------------
// Tipos del dominio
// ---------------------------------------------------------------
export type {
  Invitation,
  InvitationDelivery,
  InvitationDeliveryStatus,
  InvitationId,
  InviterPermissions,
  PendingInvitation,
} from './domain/types'

// ---------------------------------------------------------------
// Schemas Zod + constants de moderación
// ---------------------------------------------------------------
export {
  BLOCK_MEMBER_REASON_MAX_LENGTH,
  EXPEL_MEMBER_REASON_MAX_LENGTH,
  UNBLOCK_MEMBER_MESSAGE_MAX_LENGTH,
  acceptInvitationTokenSchema,
  blockMemberInputSchema,
  expelMemberInputSchema,
  inviteMemberSchema,
  leaveMembershipPlaceSlugSchema,
  resendInvitationSchema,
  unblockMemberInputSchema,
  type AcceptInvitationToken,
  type BlockMemberInput,
  type ExpelMemberInput,
  type InviteMemberInput,
  type LeaveMembershipPlaceSlug,
  type ResendInvitationInput,
  type UnblockMemberInput,
} from './schemas'

// ---------------------------------------------------------------
// Server Actions (callables desde Client Components via RSC)
// ---------------------------------------------------------------
export {
  acceptInvitationAction,
  inviteMemberAction,
  leaveMembershipAction,
  resendInvitationAction,
} from './server/actions'

// F.4 (rich-text): autocomplete `@user` para composers — Server Action
// wrapper de la query cacheada `searchMembersByPlace`.
export { searchMembersByPlaceAction } from './server/actions/mention-search'

// ---------------------------------------------------------------
// UI client-safe (no consumen server-only)
// ---------------------------------------------------------------
export { MemberAvatar } from './ui/member-avatar'
export { InviteMemberForm } from './ui/invite-form'
export { AcceptInvitationView } from './ui/accept-invitation-view'
export { LeaveButton } from './ui/leave-button'
export { ResendInvitationButton } from './ui/resend-invitation-button'
export { OwnersAccessPanel } from './ui/owners-access-panel'
export { BlockMemberDialog } from './moderation/ui/block-member-dialog'
export { ExpelMemberDialog } from './moderation/ui/expel-member-dialog'

// ---------------------------------------------------------------
// Helpers puros (sin imports server-only)
// ---------------------------------------------------------------
export {
  RESEND_EVENT_TO_STATUS,
  canTransition as canTransitionInvitationDelivery,
} from './server/delivery-transitions'
