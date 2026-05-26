import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Member } from "@/features/members/public";
import {
  MemberRowActionsMenu,
  type MemberRowActionsMenuActions,
  type MemberRowActionsMenuCallerContext,
  type MemberRowActionsMenuLabels,
} from "../member-row-actions-menu";

// Tests RTL de `<MemberRowActionsMenu />` — Feature E V1 §S10 (tests.md §S10,
// spec §"UI screens" S10). Matriz role × role (6 casos) + 1 flow happy path.
// Seam-split canónico: 4 actions (elevate/revoke/remove/transfer) inyectadas;
// tests `vi.fn()`. ConfirmDialog shared/ui maneja la confirmación destructive.
//
// **Decisión canónica V1 (fija acá, tests.md §S10 caso 2 lo dejaba abierto)**:
// sólo el founder eleva (UI restrictiva); co-owners pueden remove + revoke
// pero no elevate ni transfer. La DEFINER `app.elevate_to_owner` (Feature D)
// permite cualquier owner; la UI es más conservadora V1 — gap consciente,
// trivial relajar post-V1.
//
// **Self-row + founder**: sin acciones destructivas (founder no auto-revoca,
// V1 sin auto-step-down). **Self-row + co-owner**: sin acciones destructivas
// (RevokeError.cannot_self_revoke V1).
// **Caller miembro no-owner**: menú no aparece (trigger ausente).
//
// Cobertura (6 matriz + 1 flow = 7 casos):

const ROW_MEMBER: Member = {
  userId: "u_member",
  displayName: "Carol Member",
  handle: "carol",
  avatarUrl: null,
  headline: null,
  joinedAt: new Date("2026-03-01T10:00:00Z"),
  isOwner: false,
  isFounder: false,
};

const ROW_COOWNER: Member = {
  userId: "u_coowner",
  displayName: "Bob CoOwner",
  handle: "bob",
  avatarUrl: null,
  headline: null,
  joinedAt: new Date("2026-02-01T10:00:00Z"),
  isOwner: true,
  isFounder: false,
};

const ROW_FOUNDER_SELF: Member = {
  userId: "u_founder",
  displayName: "Alice Founder",
  handle: "alice",
  avatarUrl: null,
  headline: null,
  joinedAt: new Date("2026-01-01T10:00:00Z"),
  isOwner: true,
  isFounder: true,
};

const CALLER_FOUNDER: MemberRowActionsMenuCallerContext = {
  userId: "u_founder",
  isOwner: true,
  isFounder: true,
};

const CALLER_COOWNER: MemberRowActionsMenuCallerContext = {
  userId: "u_coowner",
  isOwner: true,
  isFounder: false,
};

const CALLER_NON_OWNER: MemberRowActionsMenuCallerContext = {
  userId: "u_member",
  isOwner: false,
  isFounder: false,
};

const LABELS: MemberRowActionsMenuLabels = {
  triggerLabel: "Acciones para {name}",
  elevateLabel: "Hacer co-owner",
  removeLabel: "Remover miembro",
  revokeOwnershipLabel: "Revocar co-owner",
  transferFounderLabel: "Transferir founder",
  confirmRemoveTitle: "Remover miembro",
  confirmRemoveBody: "¿Remover a {name} del place?",
  confirmRevokeTitle: "Revocar co-owner",
  confirmRevokeBody: "{name} dejará de ser co-owner.",
  confirmTransferTitle: "Transferir founder",
  confirmTransferBody:
    "Vas a transferir el rol de founder a {name}. Perdés tu ownership.",
  confirmYes: "Confirmar",
  confirmNo: "Cancelar",
  errorUnauthorized: "Necesitás iniciar sesión.",
  errorNotOwner: "Solo los owners pueden hacer esto.",
  errorNotFounder: "Solo el founder puede transferir.",
  errorTargetIsOwner: "Primero revocá su rol de co-owner.",
  errorCannotSelfRemove: "No podés removerte a vos mismo.",
  errorTargetNotActiveMember: "Esta persona ya no es miembro activa.",
  errorCannotRevokeFounder:
    "El founder no se puede revocar — transferí primero.",
  errorCannotSelfRevoke: "No podés revocarte a vos mismo.",
  errorLastOwner: "No podés revocar al último owner del place.",
  errorTargetNotOwner: "Esta persona ya no es owner.",
  errorTargetAlreadyOwner: "Esta persona ya es owner.",
  errorTargetNotMember: "Esta persona no es miembro activa.",
  errorCannotTransferToSelf: "No podés transferir a vos mismo.",
  errorPlaceNotFound: "Place no encontrado.",
  errorGeneric: "Algo salió mal. Probá de nuevo.",
};

function makeActions(
  overrides: Partial<MemberRowActionsMenuActions> = {},
): MemberRowActionsMenuActions {
  return {
    elevateAction: vi.fn(async () => ({ ok: true as const })),
    revokeOwnershipAction: vi.fn(async () => ({ ok: true as const })),
    removeAction: vi.fn(async () => ({ ok: true as const })),
    transferFounderAction: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
}

function setup(opts: {
  member: Member;
  callerCtx: MemberRowActionsMenuCallerContext;
  actions?: MemberRowActionsMenuActions;
}) {
  const actions = opts.actions ?? makeActions();
  const utils = render(
    <MemberRowActionsMenu
      member={opts.member}
      callerCtx={opts.callerCtx}
      placeId="place_42"
      placeSlug="mi-club"
      actions={actions}
      labels={LABELS}
    />,
  );
  return { ...utils, actions };
}

describe("<MemberRowActionsMenu />", () => {
  it("Caller founder, row no-owner → items [Hacer co-owner, Remover miembro]", async () => {
    const user = userEvent.setup();
    setup({ member: ROW_MEMBER, callerCtx: CALLER_FOUNDER });
    await user.click(
      screen.getByRole("button", { name: /Acciones para Carol Member/ }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Hacer co-owner" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Remover miembro" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Revocar co-owner" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Transferir founder" }),
    ).not.toBeInTheDocument();
  });

  it("Caller co-owner, row no-owner → items [Remover miembro] (sin elevate, UI restrictiva V1)", async () => {
    const user = userEvent.setup();
    setup({ member: ROW_MEMBER, callerCtx: CALLER_COOWNER });
    await user.click(
      screen.getByRole("button", { name: /Acciones para Carol Member/ }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Remover miembro" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Hacer co-owner" }),
    ).not.toBeInTheDocument();
  });

  it("Caller founder, row co-owner → items [Revocar co-owner, Transferir founder]", async () => {
    const user = userEvent.setup();
    setup({ member: ROW_COOWNER, callerCtx: CALLER_FOUNDER });
    await user.click(
      screen.getByRole("button", { name: /Acciones para Bob CoOwner/ }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Revocar co-owner" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Transferir founder" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Remover miembro" }),
    ).not.toBeInTheDocument();
  });

  it("Caller co-owner, row co-owner → items [Revocar co-owner] (sin transfer)", async () => {
    const user = userEvent.setup();
    // Row es OTRO co-owner — el caller co-owner CALLER_COOWNER no es self
    // sobre ROW_COOWNER (mismo userId u_coowner). Cambiamos el row para
    // que no sea self: nuevo coowner row.
    const otherCoOwner: Member = {
      ...ROW_COOWNER,
      userId: "u_other_coowner",
      displayName: "Dan OtherCoOwner",
      handle: "dan",
    };
    setup({ member: otherCoOwner, callerCtx: CALLER_COOWNER });
    await user.click(
      screen.getByRole("button", { name: /Acciones para Dan OtherCoOwner/ }),
    );
    expect(
      screen.getByRole("menuitem", { name: "Revocar co-owner" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Transferir founder" }),
    ).not.toBeInTheDocument();
  });

  it("Caller founder, row founder mismo (self) → menú trigger NO se renderea (sin acciones V1)", () => {
    setup({ member: ROW_FOUNDER_SELF, callerCtx: CALLER_FOUNDER });
    expect(
      screen.queryByRole("button", {
        name: /Acciones para Alice Founder/,
      }),
    ).not.toBeInTheDocument();
  });

  it("Caller miembro no-owner, row cualquier → menú trigger NO se renderea", () => {
    setup({ member: ROW_COOWNER, callerCtx: CALLER_NON_OWNER });
    expect(
      screen.queryByRole("button", { name: /Acciones para/ }),
    ).not.toBeInTheDocument();
  });

  it("Click 'Remover miembro' → ConfirmDialog visible, click 'Confirmar' → removeAction invocada con shape correcto", async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    setup({ member: ROW_MEMBER, callerCtx: CALLER_FOUNDER, actions });
    await user.click(
      screen.getByRole("button", { name: /Acciones para Carol Member/ }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Remover miembro" }));

    expect(
      await screen.findByText("¿Remover a Carol Member del place?"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(actions.removeAction).toHaveBeenCalledTimes(1));
    expect(actions.removeAction).toHaveBeenCalledWith(
      { placeId: "place_42", targetUserId: "u_member" },
      "mi-club",
    );
  });
});
