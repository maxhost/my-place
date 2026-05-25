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
// S10 cierra los componentes UI con 3 Client Components: `<MembersList />`
// (tabla con avatar+handle+headline+badges), `<MemberRowActionsMenu />`
// (context menu condicional por matriz role × role del caller × row) y
// `<HeadlineEditor />` (inline editor self-only del headline). Mismo
// seam-split: 4 actions del slot ownership/membership (elevate/revoke/
// remove/transfer) + updateMyHeadlineAction se inyectan como props —
// page S11 inyecta las reales, tests RTL `vi.fn()`. Re-exporta también
// los 3 contracts de labels para que el page S11 pueda tipear el
// dispatch desde el i18n.
//
// S10.5 — **Plan B split**: los 3 wrappers Feature D reutilizadas
// (`elevateToOwnerAction`, `revokeOwnershipAction`,
// `transferFounderOwnershipAction`) + sus error types + Input types se
// movieron al slice hermano `src/features/members-ownership/`
// (plan-sesiones §S8 nota LOC + §S10 pre-commit checklist). Este barrel
// queda con: queries + invitations + headline + remove-member (slice
// core de membership). La UI (`<MembersList />` + `<MemberRowActionsMenu />`)
// importa las 3 ownership actions cross-slice desde
// `@/features/members-ownership/public`.
//
// Lo que NO se exporta (intencional):
//   - Shapes crudos de las queries (LoadedMemberRow, etc.) — internos al
//     wrapper, no consumibles por capas superiores.
//   - Mapeo de errores `_lib/` y zod schemas — internos al slice; cualquier
//     consumer cross-feature usa las actions, no los maps puros.

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
export type {
  CreateInvitationInput,
  RemoveMemberInput,
  RevokeInvitationInput,
  UpdateMyHeadlineInput,
} from "./actions/_lib/schemas";

export {
  getMemberRole,
  type HeadlineError,
  type InviteError,
  type Member,
  type MemberRole,
  type PendingInvitation,
  type RemoveMemberError,
  type RevokeInviteError,
} from "./types";

export {
  InviteMemberModal,
  type InviteMemberModalLabels,
} from "./ui/invite-member-modal";
export {
  PendingInvitationsTab,
  type PendingInvitationsTabLabels,
} from "./ui/pending-invitations-tab";
export {
  MembersList,
  type MembersListActions,
  type MembersListCallerContext,
  type MembersListLabels,
} from "./ui/members-list";
export {
  MemberRowActionsMenu,
  type MemberRowActionsMenuActions,
  type MemberRowActionsMenuCallerContext,
  type MemberRowActionsMenuLabels,
} from "./ui/member-row-actions-menu";
export {
  HeadlineEditor,
  type HeadlineEditorLabels,
} from "./ui/headline-editor";
