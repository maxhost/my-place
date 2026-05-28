import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PendingInvitation } from "@/features/invitations/public";
import type { Member } from "@/features/members/public";

import type { MemberRowActionsMenuCallerContext } from "../member-row-actions-menu";
import {
  MembersPageShell,
  type MembersPageShellActions,
  type MembersPageShellLabels,
} from "../members-page-shell";

// Tests RTL del `<MembersPageShell />` — Client Component page-level co-
// located (Feature E V1 §S11, convención `_components/` inaugurada por
// ADR-0043). Orquesta tabs + invite modal + render-prop al menú page-level.
//
// Cubre lo que el page RSC NO puede verificar barato (state client-side:
// tabs + modal open). El page RSC `page.tsx` se verifica por typecheck +
// smoke manual S11/S12 — consistente con re-baseline S7/S8 plan-sesiones
// ("lo testeable con vitest es la lógica pura extraída + RTL sobre Client
// Components; pages cruzan next/headers + Neon Auth + queries y se
// verifican por typecheck + smoke en producción").
//
// Cobertura (3 casos):
//   1. Render inicial = tab "Activos" seleccionada, MembersList visible con
//      menú trigger inyectado por fila non-self.
//   2. Click tab "Pendientes" → switch al PendingInvitationsTab.
//   3. Click "Invitar miembro" → modal abre; close → modal cierra.

const MEMBER_FOUNDER_SELF: Member = {
  userId: "u_alice",
  displayName: "Alice Founder",
  handle: "alice",
  avatarUrl: null,
  headline: null,
  joinedAt: new Date("2026-01-01T10:00:00Z"),
  isOwner: true,
  isFounder: true,
};

const MEMBER_NORMAL: Member = {
  userId: "u_carol",
  displayName: "Carol Member",
  handle: "carol",
  avatarUrl: null,
  headline: null,
  joinedAt: new Date("2026-03-01T10:00:00Z"),
  isOwner: false,
  isFounder: false,
};

const PENDING_INV: PendingInvitation = {
  invitationId: "inv_1",
  email: "bob@test.com",
  expiresAt: new Date("2026-06-01T00:00:00Z"),
  invitedByDisplayName: "Alice Founder",
};

const CALLER_FOUNDER: MemberRowActionsMenuCallerContext = {
  userId: "u_alice",
  isOwner: true,
  isFounder: true,
};

const LABELS: MembersPageShellLabels = {
  tabActive: "Activos",
  tabPending: "Pendientes",
  inviteButton: "Invitar miembro",
  list: {
    emptyTitle: "Sin miembros",
    emptyDescription:
      "Cuando alguien acepte una invitación, aparecerá acá.",
    badgeFounder: "Founder",
    badgeOwner: "Owner",
  },
  actionsMenu: {
    triggerLabel: "Acciones para {name}",
    elevateLabel: "Hacer co-owner",
    removeLabel: "Remover miembro",
    revokeOwnershipLabel: "Revocar co-owner",
    transferFounderLabel: "Transferir founder",
    confirmRemoveTitle: "Remover miembro",
    confirmRemoveBody: "¿Remover a {name}?",
    confirmRevokeTitle: "Revocar co-owner",
    confirmRevokeBody: "{name} dejará de ser owner.",
    confirmTransferTitle: "Transferir founder",
    confirmTransferBody: "Transferir a {name}",
    confirmYes: "Confirmar",
    confirmNo: "Cancelar",
    errorUnauthorized: "Necesitás sesión",
    errorNotOwner: "Solo owners",
    errorNotFounder: "Solo founder",
    errorTargetIsOwner: "Es owner",
    errorCannotSelfRemove: "Self-remove",
    errorTargetNotActiveMember: "Inactivo",
    errorCannotRevokeFounder: "No founder",
    errorCannotSelfRevoke: "Self-revoke",
    errorLastOwner: "Last owner",
    errorTargetNotOwner: "No owner",
    errorTargetAlreadyOwner: "Ya owner",
    errorTargetNotMember: "No member",
    errorCannotTransferToSelf: "Self transfer",
    errorPlaceNotFound: "Place not found",
    errorGeneric: "Algo salió mal",
  },
  inviteModal: {
    title: "Invitar miembro",
    description: "Cualquiera con el link puede unirse.",
    emailLabel: "Email",
    emailPlaceholder: "ejemplo@x.com",
    expiresLabel: "Días",
    submitButton: "Generar link",
    submitting: "Generando…",
    successHeading: "Listo. Compartí este link:",
    copyButton: "Copiar",
    copiedTooltip: "Copiado",
    closeButton: "Cerrar",
    errorInvalidEmail: "Email inválido",
    errorInvalidExpires: "Días fuera de rango",
    errorUnauthorized: "Sesión",
    errorNotOwner: "Solo owners pueden invitar",
    errorExpiresInPast: "Pasado",
    errorRateLimited: "Demasiadas invitaciones",
    errorGeneric: "Error",
  },
  pending: {
    emptyTitle: "Sin invitaciones pendientes",
    emptyDescription: "Cuando crees una invitación aparecerá acá.",
    invitedByPrefix: "Invitado por",
    expiresLabel: "Expira",
    revokeButton: "Revocar",
    confirmTitle: "Revocar invitación",
    confirmBody: "El link enviado a {email} dejará de funcionar.",
    confirmYes: "Sí",
    confirmNo: "No",
    errorUnauthorized: "Sesión",
    errorNotOwner: "Owners",
    errorNotFound: "No existe",
    errorAlreadyAccepted: "Aceptada",
    errorGeneric: "Error",
  },
};

function makeActions(): MembersPageShellActions {
  return {
    createInvitation: vi.fn(async () => ({
      ok: true as const,
      invitationId: "inv_new",
      token: "t_abc",
    })),
    revokeInvitation: vi.fn(async () => ({ ok: true as const })),
    menu: {
      elevateAction: vi.fn(async () => ({ ok: true as const })),
      revokeOwnershipAction: vi.fn(async () => ({ ok: true as const })),
      removeAction: vi.fn(async () => ({ ok: true as const })),
      transferFounderAction: vi.fn(async () => ({ ok: true as const })),
    },
  };
}

function setup(
  opts: {
    members?: Member[];
    pending?: PendingInvitation[];
    callerCtx?: MemberRowActionsMenuCallerContext;
  } = {},
) {
  const actions = makeActions();
  const utils = render(
    <MembersPageShell
      members={opts.members ?? [MEMBER_FOUNDER_SELF, MEMBER_NORMAL]}
      pendingInvitations={opts.pending ?? [PENDING_INV]}
      callerCtx={opts.callerCtx ?? CALLER_FOUNDER}
      placeId="p_1"
      placeSlug="mi-club"
      inviteBaseUrl="https://mi-club.place.community"
      actions={actions}
      labels={LABELS}
    />,
  );
  return { ...utils, actions };
}

describe("<MembersPageShell />", () => {
  it("render inicial: tab Activos seleccionada, MembersList visible con menú inyectado", () => {
    setup();
    const activeTab = screen.getByRole("tab", { name: "Activos" });
    expect(activeTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Alice Founder")).toBeInTheDocument();
    expect(screen.getByText("Carol Member")).toBeInTheDocument();
    // Menu trigger inyectado por fila non-self con caller owner
    expect(
      screen.getByRole("button", { name: /Acciones para Carol Member/ }),
    ).toBeInTheDocument();
    // No trigger para alice (self) — defense V1 + spec §S10 caso 5
    expect(
      screen.queryByRole("button", { name: /Acciones para Alice Founder/ }),
    ).not.toBeInTheDocument();
  });

  it("click tab 'Pendientes' → cambia a PendingInvitationsTab", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("tab", { name: "Pendientes" }));
    expect(
      screen.getByRole("tab", { name: "Pendientes" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("bob@test.com")).toBeInTheDocument();
    // MembersList ya no se muestra en este tab
    expect(screen.queryByText("Carol Member")).not.toBeInTheDocument();
  });

  it("click 'Invitar miembro' → modal abre; click 'Cerrar' → modal cierra", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Invitar miembro" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // El form del modal tiene el email label visible
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cerrar" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
