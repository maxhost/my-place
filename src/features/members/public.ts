// Interfaz pública del slice `members` (Feature E V1, paradigma
// vertical-slice `docs/architecture.md` §17-25): los demás features /
// rutas (page `/[placeSlug]/(place)/settings/members/page.tsx` S11 +
// consumers cross-slice) importan SÓLO desde acá, nunca de internals
// (regla ESLint ADR-0039 valida).
//
// Slice diet S10.5-S10.9 — este slice quedó con el core de membership:
//   - `loadMembers` (query) — listado roster del place.
//   - `removeMemberAction` — wrap sobre `app.remove_member`.
//   - `Member` + `MemberRole` + `getMemberRole` — shape + derivación rol.
//   - `RemoveMemberError` — 1 error union discriminable.
//   - `<MembersList />` — Client Component presentacional puro (render-prop
//     `renderRowActions` para el slot por fila).
//
// Slices hermanos extraídos por capability (cap LOC ≤1500 CLAUDE.md):
//   - `place-ownership-actions/` (S10.5 Plan B, S10.6 ADR-0040):
//     ELIMINADO por ADR-0054 (un place = un owner) — las 3 ownership
//     actions (elevate/revoke/transfer) dejaron de ser producto.
//   - `invitations/` (S10.7 ADR-0041): 1 query + 2 actions + 2 UI
//     components + tipos + schemas. Consumido cross-slice por el page
//     S11 que ensambla `<MembersList />` + `<PendingInvitationsTab />`.
//   - `member-profile/` (S10.8 ADR-0042): 1 action + 1 UI component +
//     tipos. Consumido cross-slice por el page S11 (sección "Tu perfil
//     en este place"). Reserva V1.1+ para avatar contextual.
//
// Componente page-level co-located (S10.9 ADR-0043) — NO vive en este
// slice:
//   - `<MemberRowActionsMenu />` (`src/app/.../settings/members/
//     _components/member-row-actions-menu.tsx`): context menu por fila,
//     remover-only post ADR-0054 — consume sólo `removeMemberAction` de
//     este slice. El page S11 lo inyecta a `<MembersList />` vía
//     render-prop `renderRowActions`. Razón en ADR-0043.
//
// Lo que NO se exporta (intencional):
//   - Shapes crudos de las queries (LoadedMemberRow, etc.) — internos al
//     wrapper, no consumibles por capas superiores.
//   - Mapeo de errores `_lib/` y zod schemas — internos al slice; cualquier
//     consumer cross-feature usa las actions, no los maps puros.

export { loadMembers } from "./queries/load-members";

export {
  removeMemberAction,
  type RemoveMemberResult,
} from "./actions/remove-member";
export type { RemoveMemberInput } from "./actions/_lib/schemas";

export {
  getMemberRole,
  type Member,
  type MemberRole,
  type RemoveMemberError,
} from "./types";

export {
  MembersList,
  type MembersListLabels,
} from "./ui/members-list";
