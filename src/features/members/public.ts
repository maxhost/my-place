// Interfaz pública del slice `members` (Feature E V1, paradigma
// vertical-slice `docs/architecture.md` §17-25): los demás features /
// rutas (futuro page `/[placeSlug]/(place)/settings/members/page.tsx`
// S11 + consumers cross-slice) importan SÓLO desde acá, nunca de
// internals.
//
// S6 cierra la foundation del slice: tipos del dominio + queries
// owner-only (RLS-aware). S7-S8 agregan Server Actions; S9-S10 UI;
// S11 cablea el page + sidebar + i18n; S12 smoke E2E.
//
// Re-exports V1:
//   - 2 queries server-side (`loadMembers` + `loadPendingInvitations`)
//     consumidas por el page RSC (S11) dentro de
//     `getAuthenticatedDbForRequest(...)` (ADR-0034).
//   - 2 shapes del dominio (`Member` + `PendingInvitation`) — payload
//     canónico que la UI consume.
//   - 1 union `MemberRole` + 1 helper puro `getMemberRole` —
//     derivación canónica del rol para badges/i18n (`<Badge variant={role}>`
//     en S10).
//   - 7 error unions discriminables — superficie public-stable que las
//     Server Actions de S7-S8 retornan en su Result, y que la UI rama por
//     `switch` exhaustivo para mostrar copy i18n específico.
//
// S9 amplía el barrel con 2 Client Components del slot invitations
// (`<InviteMemberModal />` + `<PendingInvitationsTab />`). Seam-split:
// ambos reciben la Server Action como prop — el page S11 inyecta las
// reales (`createInvitationAction` / `revokeInvitationAction`) y el slice
// queda testeable RTL puro con `vi.fn()`.
//
// Lo que NO se exporta (intencional):
//   - Shapes crudos de las queries (LoadedMemberRow, etc.) — internos al
//     wrapper, no consumibles por capas superiores.
//   - Mapeo de errores `_lib/` y zod schemas — internos al slice; cualquier
//     consumer cross-feature usa las actions, no los maps puros.
//   - UI components S10 — se agregan al barrel cuando existan.

export { loadMembers } from "./queries/load-members";
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
  updateMyHeadlineAction,
  type UpdateMyHeadlineResult,
} from "./actions/update-my-headline";
export {
  removeMemberAction,
  type RemoveMemberResult,
} from "./actions/remove-member";
export {
  elevateToOwnerAction,
  type ElevateToOwnerResult,
} from "./actions/elevate-to-owner";
export {
  revokeOwnershipAction,
  type RevokeOwnershipResult,
} from "./actions/revoke-ownership";
export {
  transferFounderOwnershipAction,
  type TransferFounderOwnershipResult,
} from "./actions/transfer-founder-ownership";
export type {
  CreateInvitationInput,
  ElevateToOwnerInput,
  RemoveMemberInput,
  RevokeInvitationInput,
  RevokeOwnershipInput,
  TransferFounderOwnershipInput,
  UpdateMyHeadlineInput,
} from "./actions/_lib/schemas";

export {
  getMemberRole,
  type ElevateError,
  type HeadlineError,
  type InviteError,
  type Member,
  type MemberRole,
  type PendingInvitation,
  type RemoveMemberError,
  type RevokeError,
  type RevokeInviteError,
  type TransferError,
} from "./types";

export {
  InviteMemberModal,
  type InviteMemberModalLabels,
} from "./ui/invite-member-modal";
export {
  PendingInvitationsTab,
  type PendingInvitationsTabLabels,
} from "./ui/pending-invitations-tab";
