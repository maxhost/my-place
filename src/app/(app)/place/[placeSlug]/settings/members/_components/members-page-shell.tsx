"use client";

import { useId, useState } from "react";

import {
  type createInvitationAction,
  InviteMemberModal,
  type InviteMemberModalLabels,
  type PendingInvitation,
  PendingInvitationsTab,
  type PendingInvitationsTabLabels,
  type revokeInvitationAction,
} from "@/features/invitations/public";
import {
  type Member,
  MembersList,
  type MembersListLabels,
} from "@/features/members/public";

import {
  MemberRowActionsMenu,
  type MemberRowActionsMenuActions,
  type MemberRowActionsMenuCallerContext,
  type MemberRowActionsMenuLabels,
} from "./member-row-actions-menu";

// `<MembersPageShell />` — Feature E V1 §S11. Client Component page-level
// co-located (convención `_components/` inaugurada por ADR-0043) que
// orquesta el estado client-side del page `/settings/members`: tab activa
// (Activos/Pendientes) + visibility del invite modal + cableado del menú
// page-level vía render-prop a `<MembersList />`.
//
// **Por qué Client + page-level (no slice):** el shell ensambla 4 slices
// (`members/` + `invitations/` + `place-ownership-actions/` + `member-
// profile/` futuro) con state coordinado. No tiene capability DB propia ni
// spec independiente — ADR-0028 §"Política a futuro" descarta promoverlo a
// slice. Vive cerca de su único consumer (la page RSC) en `_components/`,
// como el `<MemberRowActionsMenu />` (ADR-0043).
//
// **Por qué se justifica testearlo con vitest (vs el page RSC):** el page
// `page.tsx` cruza `next/headers` + Neon Auth + queries + i18n —
// mock-heavy + frágil. El shell es Client puro con state observable, RTL-
// testable como el resto del slice (precedente: `<MemberRowActionsMenu />`
// .test.tsx). Aligned con re-baseline S7/S8 plan-sesiones §"lo testeable
// con vitest es la lógica pura extraída + RTL".
//
// **Pattern de tabs**: WAI-ARIA tablist + tab + tabpanel mínimo (sin
// `useEffect` keyboard nav V1 — accesibilidad básica con click/Enter en
// botones que ya son focusable nativos). Render condicional: sólo la
// pane activa monta — evita confusión de RTL `getByText` matching ambos
// panes (caso real cubierto en `members-page-shell.test.tsx` caso 2).
//
// **Modal mount on demand**: el `<InviteMemberModal />` sólo se renderea
// cuando `inviteOpen === true`. Evita montaje preventivo del form y
// resetea estado al re-abrir (el `useState` interno del modal se
// reinicializa cada mount).
//
// **HeadlineEditor**: NO se monta en este shell V1. Spec §"UI screens" S10
// lo ubica en el perfil contextual del miembro (modal al tappear el propio
// avatar), no en /settings/members. Las keys `placeMembers.headline.*`
// están en el catálogo i18n S11 para cuando el perfil modal se cablee.

export type MembersPageShellLabels = {
  tabActive: string;
  tabPending: string;
  inviteButton: string;
  list: MembersListLabels;
  actionsMenu: MemberRowActionsMenuLabels;
  inviteModal: InviteMemberModalLabels;
  pending: PendingInvitationsTabLabels;
};

export type MembersPageShellActions = {
  createInvitation: typeof createInvitationAction;
  revokeInvitation: typeof revokeInvitationAction;
  menu: MemberRowActionsMenuActions;
};

type TabKey = "active" | "pending";

const tabActiveCls =
  "inline-flex min-h-[2.5rem] items-center justify-center rounded-lg border border-border bg-bg px-4 text-sm font-medium text-ink";
const tabIdleCls =
  "inline-flex min-h-[2.5rem] items-center justify-center rounded-lg border border-transparent px-4 text-sm font-medium text-muted hover:opacity-80";
const ctaCls =
  "cta inline-flex min-h-[2.5rem] items-center justify-center rounded-lg px-5 text-sm font-medium";

export function MembersPageShell({
  members,
  pendingInvitations,
  callerCtx,
  placeId,
  placeSlug,
  locale,
  inviteBaseUrl,
  actions,
  labels,
}: {
  members: Member[];
  pendingInvitations: PendingInvitation[];
  callerCtx: MemberRowActionsMenuCallerContext;
  placeId: string;
  placeSlug: string;
  /** Locale del place (`place.default_locale`) — formatea la caducidad del tab pending. */
  locale: string;
  /** Base URL sin trailing slash. El modal templea `${base}/invite/<token>`. */
  inviteBaseUrl: string;
  actions: MembersPageShellActions;
  labels: MembersPageShellLabels;
}) {
  const [tab, setTab] = useState<TabKey>("active");
  const [inviteOpen, setInviteOpen] = useState(false);

  const tabActiveId = useId();
  const tabPendingId = useId();
  const panelActiveId = useId();
  const panelPendingId = useId();

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 md:px-8">
        <div
          role="tablist"
          aria-label={labels.tabActive}
          className="flex flex-wrap gap-2"
        >
          <button
            type="button"
            role="tab"
            id={tabActiveId}
            aria-selected={tab === "active"}
            aria-controls={panelActiveId}
            onClick={() => setTab("active")}
            className={tab === "active" ? tabActiveCls : tabIdleCls}
          >
            {labels.tabActive}
          </button>
          <button
            type="button"
            role="tab"
            id={tabPendingId}
            aria-selected={tab === "pending"}
            aria-controls={panelPendingId}
            onClick={() => setTab("pending")}
            className={tab === "pending" ? tabActiveCls : tabIdleCls}
          >
            {labels.tabPending}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className={ctaCls}
        >
          {labels.inviteButton}
        </button>
      </div>

      {tab === "active" ? (
        <div
          role="tabpanel"
          id={panelActiveId}
          aria-labelledby={tabActiveId}
        >
          <MembersList
            members={members}
            labels={labels.list}
            renderRowActions={(member) => (
              <MemberRowActionsMenu
                member={member}
                callerCtx={callerCtx}
                placeId={placeId}
                placeSlug={placeSlug}
                actions={actions.menu}
                labels={labels.actionsMenu}
              />
            )}
          />
        </div>
      ) : (
        <div
          role="tabpanel"
          id={panelPendingId}
          aria-labelledby={tabPendingId}
        >
          <PendingInvitationsTab
            invitations={pendingInvitations}
            placeSlug={placeSlug}
            locale={locale}
            revokeAction={actions.revokeInvitation}
            labels={labels.pending}
          />
        </div>
      )}

      {inviteOpen && (
        <InviteMemberModal
          placeId={placeId}
          placeSlug={placeSlug}
          inviteBaseUrl={inviteBaseUrl}
          createAction={actions.createInvitation}
          onClose={() => setInviteOpen(false)}
          labels={labels.inviteModal}
        />
      )}
    </section>
  );
}
