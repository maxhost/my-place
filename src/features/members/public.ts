/**
 * API pública del slice `members`. Único punto de entrada desde otras partes del sistema.
 * Ver `docs/architecture.md` § boundaries.
 */

export type {
  Invitation,
  InvitationDelivery,
  InvitationDeliveryStatus,
  InvitationId,
  InviterPermissions,
  MembershipRole,
  PendingInvitation,
} from './domain/types'
export {
  inviteMemberSchema,
  resendInvitationSchema,
  type InviteMemberInput,
  type ResendInvitationInput,
} from './schemas'
export {
  acceptInvitationAction,
  inviteMemberAction,
  leaveMembershipAction,
  resendInvitationAction,
} from './server/actions'
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
export { InviteMemberForm } from './ui/invite-form'
export { MemberAvatar } from './ui/member-avatar'
export { AcceptInvitationView } from './ui/accept-invitation-view'
export { LeaveButton } from './ui/leave-button'
export { PendingInvitationsList } from './ui/pending-invitations-list'
export { ResendInvitationButton } from './ui/resend-invitation-button'
export {
  RESEND_EVENT_TO_STATUS,
  canTransition as canTransitionInvitationDelivery,
} from './server/delivery-transitions'
export { runErasure } from './server/erasure/run-erasure'
export type { ErasureRunResult } from './server/erasure/types'
