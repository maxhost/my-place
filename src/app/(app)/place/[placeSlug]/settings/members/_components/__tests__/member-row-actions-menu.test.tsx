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

// Tests RTL de `<MemberRowActionsMenu />` — contrato remover-only post
// ADR-0054 (un place = un owner). El menú canaliza UNA sola acción
// (`remove`) inyectada vía `actions` bag (`vi.fn()` en tests); el
// ConfirmDialog shared/ui maneja la confirmación destructive.
//
// **Matriz V2 (single-owner)**: sólo el owner ve el menú, sólo sobre filas
// non-self y non-owner. Self-row y row owner: trigger ausente (defense-in-
// depth UX sobre `cannot_self_remove` / `target_is_owner`).
//
// Cobertura (5 matriz/flow + 1 error path = 6 casos):

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

const ROW_OWNER_SELF: Member = {
  userId: "u_owner",
  displayName: "Alice Owner",
  handle: "alice",
  avatarUrl: null,
  headline: null,
  joinedAt: new Date("2026-01-01T10:00:00Z"),
  isOwner: true,
  isFounder: true,
};

const CALLER_OWNER: MemberRowActionsMenuCallerContext = {
  userId: "u_owner",
  isOwner: true,
  isFounder: true,
};

const CALLER_NON_OWNER: MemberRowActionsMenuCallerContext = {
  userId: "u_member",
  isOwner: false,
  isFounder: false,
};

const LABELS: MemberRowActionsMenuLabels = {
  triggerLabel: "Acciones para {name}",
  removeLabel: "Remover miembro",
  confirmRemoveTitle: "Remover miembro",
  confirmRemoveBody: "¿Remover a {name} del place?",
  confirmYes: "Confirmar",
  confirmNo: "Cancelar",
  errorUnauthorized: "Necesitás iniciar sesión.",
  errorNotOwner: "Solo los owners pueden hacer esto.",
  errorTargetIsOwner: "No se puede remover a un owner.",
  errorCannotSelfRemove: "No podés removerte a vos mismo.",
  errorTargetNotActiveMember: "Esta persona ya no es miembro activa.",
  errorGeneric: "Algo salió mal. Probá de nuevo.",
};

function makeActions(
  overrides: Partial<MemberRowActionsMenuActions> = {},
): MemberRowActionsMenuActions {
  return {
    removeAction: vi.fn(async () => ({ ok: true as const })),
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
  it("Caller owner, row miembro → único item [Remover miembro]", async () => {
    const user = userEvent.setup();
    setup({ member: ROW_MEMBER, callerCtx: CALLER_OWNER });
    await user.click(
      screen.getByRole("button", { name: /Acciones para Carol Member/ }),
    );
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Remover miembro");
  });

  it("Caller owner, row owner (otro hipotético) → menú trigger NO se renderea", () => {
    // Post ADR-0054 no debería existir un segundo owner; si apareciera por
    // datos stale, el menú no ofrece acciones sobre él (defense-in-depth).
    const otherOwner: Member = {
      ...ROW_OWNER_SELF,
      userId: "u_other_owner",
      displayName: "Bob Owner",
      handle: "bob",
      isFounder: false,
    };
    setup({ member: otherOwner, callerCtx: CALLER_OWNER });
    expect(
      screen.queryByRole("button", { name: /Acciones para Bob Owner/ }),
    ).not.toBeInTheDocument();
  });

  it("Caller owner, row self → menú trigger NO se renderea", () => {
    setup({ member: ROW_OWNER_SELF, callerCtx: CALLER_OWNER });
    expect(
      screen.queryByRole("button", { name: /Acciones para Alice Owner/ }),
    ).not.toBeInTheDocument();
  });

  it("Caller miembro no-owner, row cualquier → menú trigger NO se renderea", () => {
    setup({ member: ROW_MEMBER, callerCtx: CALLER_NON_OWNER });
    expect(
      screen.queryByRole("button", { name: /Acciones para/ }),
    ).not.toBeInTheDocument();
  });

  it("Click 'Remover miembro' → ConfirmDialog visible, click 'Confirmar' → removeAction invocada con shape correcto", async () => {
    const user = userEvent.setup();
    const actions = makeActions();
    setup({ member: ROW_MEMBER, callerCtx: CALLER_OWNER, actions });
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

  it("removeAction retorna error → copy mapeado visible con role=alert", async () => {
    const user = userEvent.setup();
    const actions = makeActions({
      removeAction: vi.fn(async () => ({
        ok: false as const,
        error: "target_not_active_member" as const,
      })),
    });
    setup({ member: ROW_MEMBER, callerCtx: CALLER_OWNER, actions });
    await user.click(
      screen.getByRole("button", { name: /Acciones para Carol Member/ }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Remover miembro" }));
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Esta persona ya no es miembro activa.",
    );
  });
});
