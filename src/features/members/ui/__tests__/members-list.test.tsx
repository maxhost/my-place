import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Member } from "../../types";
import {
  type MemberRowActionsMenuLabels,
  type MembersListActions,
  type MembersListCallerContext,
  type MembersListLabels,
  MembersList,
} from "../members-list";

// Tests RTL de `<MembersList />` — Feature E V1 §S10 (tests.md §S10, spec
// §"UI screens" S10). Seam-split canónico: las 4 actions (elevate/revoke/
// remove/transfer) se inyectan como `actions` prop. Tests usan `vi.fn()`;
// el page S11 inyecta las reales (`elevateToOwnerAction` etc.). Strings
// ES hardcoded — extracción i18n diferida a S11.
//
// Cobertura (4 casos, tests.md §S10 `members-list.test.tsx`):
//   1. Render array members → cada fila muestra display_name + handle.
//   2. Member con headline NOT NULL → bloque headline visible.
//   3. Member con headline NULL → bloque headline NO renderea (sin placeholder
//      pasivo, decisión ADR-0036 §1).
//   4. Badges: founder muestra Badge variant=founder; co-owner Badge variant=owner;
//      miembro sin badge.
//
// El test acá NO valida los items internos del MemberRowActionsMenu — eso lo
// cubre `member-row-actions-menu.test.tsx` (matriz 6 casos). Acá sólo
// verificamos la composición list-level.

const FOUNDER: Member = {
  userId: "u_alice",
  displayName: "Alice Founder",
  handle: "alice",
  avatarUrl: "https://x/alice.jpg",
  headline: "Fundadora del club",
  joinedAt: new Date("2026-01-01T10:00:00Z"),
  isOwner: true,
  isFounder: true,
};

const COOWNER: Member = {
  userId: "u_bob",
  displayName: "Bob CoOwner",
  handle: "bob",
  avatarUrl: null,
  headline: null,
  joinedAt: new Date("2026-02-01T10:00:00Z"),
  isOwner: true,
  isFounder: false,
};

const MEMBER: Member = {
  userId: "u_carol",
  displayName: "Carol Member",
  handle: "carol",
  avatarUrl: "https://x/carol.jpg",
  headline: "Recién llegada al barrio",
  joinedAt: new Date("2026-03-01T10:00:00Z"),
  isOwner: false,
  isFounder: false,
};

const LABELS: MembersListLabels = {
  emptyTitle: "Sin miembros activos",
  emptyDescription: "Aún no hay nadie en este place.",
  badgeFounder: "Fundador",
  badgeOwner: "Owner",
};

const MENU_LABELS: MemberRowActionsMenuLabels = {
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
  confirmTransferBody: "Vas a transferir el rol de founder a {name}. Perdés tu ownership.",
  confirmYes: "Confirmar",
  confirmNo: "Cancelar",
  errorUnauthorized: "Necesitás iniciar sesión.",
  errorNotOwner: "Solo los owners pueden hacer esto.",
  errorNotFounder: "Solo el founder puede transferir.",
  errorTargetIsOwner: "Primero revocá su rol de co-owner.",
  errorCannotSelfRemove: "No podés removerte a vos mismo.",
  errorTargetNotActiveMember: "Esta persona ya no es miembro activa.",
  errorCannotRevokeFounder: "El founder no se puede revocar — transferí primero.",
  errorCannotSelfRevoke: "No podés revocarte a vos mismo.",
  errorLastOwner: "No podés revocar al último owner del place.",
  errorTargetNotOwner: "Esta persona ya no es owner.",
  errorTargetAlreadyOwner: "Esta persona ya es owner.",
  errorTargetNotMember: "Esta persona no es miembro activa.",
  errorCannotTransferToSelf: "No podés transferir a vos mismo.",
  errorPlaceNotFound: "Place no encontrado.",
  errorGeneric: "Algo salió mal. Probá de nuevo.",
};

function makeActions(): MembersListActions {
  return {
    elevateAction: vi.fn(async () => ({ ok: true as const })),
    revokeOwnershipAction: vi.fn(async () => ({ ok: true as const })),
    removeAction: vi.fn(async () => ({ ok: true as const })),
    transferFounderAction: vi.fn(async () => ({ ok: true as const })),
  };
}

function setup(
  opts: {
    members?: Member[];
    callerCtx?: MembersListCallerContext;
    actions?: MembersListActions;
  } = {},
) {
  const callerCtx = opts.callerCtx ?? {
    userId: "u_alice",
    isOwner: true,
    isFounder: true,
  };
  const actions = opts.actions ?? makeActions();
  const utils = render(
    <MembersList
      members={opts.members ?? [FOUNDER, COOWNER, MEMBER]}
      callerCtx={callerCtx}
      placeId="place_42"
      placeSlug="mi-club"
      actions={actions}
      labels={LABELS}
      menuLabels={MENU_LABELS}
    />,
  );
  return { ...utils, actions };
}

describe("<MembersList />", () => {
  it("Render array members → cada fila muestra display_name + handle", () => {
    setup();
    expect(screen.getByText("Alice Founder")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("Bob CoOwner")).toBeInTheDocument();
    expect(screen.getByText("@bob")).toBeInTheDocument();
    expect(screen.getByText("Carol Member")).toBeInTheDocument();
    expect(screen.getByText("@carol")).toBeInTheDocument();
  });

  it("Member con headline NOT NULL → bloque headline visible", () => {
    setup();
    expect(screen.getByText("Fundadora del club")).toBeInTheDocument();
    expect(screen.getByText("Recién llegada al barrio")).toBeInTheDocument();
  });

  it("Member con headline NULL → bloque headline NO renderea (sin placeholder)", () => {
    setup({ members: [COOWNER] });
    expect(screen.queryByText(/recién/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sin headline/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument();
    expect(screen.getByText("Bob CoOwner")).toBeInTheDocument();
  });

  it("Badges: founder → variant=founder; co-owner → variant=owner; miembro → sin badge", () => {
    setup();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    const aliceRow = rows.find((r) =>
      within(r).queryByText("Alice Founder"),
    );
    const bobRow = rows.find((r) => within(r).queryByText("Bob CoOwner"));
    const carolRow = rows.find((r) => within(r).queryByText("Carol Member"));
    if (!aliceRow || !bobRow || !carolRow) throw new Error("rows missing");

    expect(within(aliceRow).getByText("Fundador")).toBeInTheDocument();
    expect(within(aliceRow).queryByText("Owner")).not.toBeInTheDocument();

    expect(within(bobRow).getByText("Owner")).toBeInTheDocument();
    expect(within(bobRow).queryByText("Fundador")).not.toBeInTheDocument();

    expect(within(carolRow).queryByText("Fundador")).not.toBeInTheDocument();
    expect(within(carolRow).queryByText("Owner")).not.toBeInTheDocument();
  });
});
