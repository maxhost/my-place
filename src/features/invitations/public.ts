// Interfaz pública del slice `invitations` (extracción S10.7 ADR-0041
// desde `members/`). Cross-slice imports SÓLO via este barrel — regla
// ESLint ADR-0039 valida.
//
// V1 expone: 1 query + 2 Server Actions + 2 Client Components + tipos
// (PendingInvitation, 2 error unions, 2 Input zod). Consumer principal:
// page S11 `/settings/members` que ensambla `<MembersList />` (slice
// `members/`) + `<PendingInvitationsTab />` (este slice) en la misma
// vista. NO se exportan maps de errores ni zod schemas — internos.

export { loadPendingInvitations } from "./queries/load-pending-invitations";

export {
  createInvitationAction,
  type CreateInvitationResult,
} from "./actions/create-invitation";
export {
  revokeInvitationAction,
  type RevokeInvitationResult,
} from "./actions/revoke-invitation";
export {
  acceptInvitationAction,
  type AcceptInvitationResult,
} from "./actions/accept-invitation";
export type {
  AcceptInvitationInput,
  CreateInvitationInput,
  RevokeInvitationInput,
} from "./actions/_lib/schemas";

export type {
  AcceptInvitationError,
  InviteError,
  PendingInvitation,
  RevokeInviteError,
} from "./types";

export {
  InviteMemberModal,
  type InviteMemberModalLabels,
} from "./ui/invite-member-modal";
export {
  PendingInvitationsTab,
  type PendingInvitationsTabLabels,
} from "./ui/pending-invitations-tab";
