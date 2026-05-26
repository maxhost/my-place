import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Member } from "../../types";
import {
  type MembersListLabels,
  MembersList,
} from "../members-list";

// Tests RTL de `<MembersList />` — Feature E V1 §S10 (tests.md §S10, spec
// §"UI screens" S10). Post S10.9 (ADR-0043): la lista pasa a render-prop
// puro — sólo recibe `members` + `labels` + opcionalmente `renderRowActions`.
// El menú de acciones por fila vive a page-level co-located
// (`src/app/.../settings/members/_components/member-row-actions-menu.tsx`)
// y el page S11 lo inyecta vía `renderRowActions={(m) => <MemberRowActionsMenu
// member={m} ... />}`. Esto reduce la lista a una capa presentacional pura
// — sin actions, sin callerCtx, sin labels del menú.
//
// Cobertura (6 casos):
//   1. Render array members → cada fila muestra display_name + handle.
//   2. Member con headline NOT NULL → bloque headline visible.
//   3. Member con headline NULL → bloque NO renderea (sin placeholder pasivo,
//      decisión ADR-0036 §1).
//   4. Badges: founder muestra Badge variant=founder; co-owner Badge
//      variant=owner; miembro sin badge.
//   5. `renderRowActions` ausente → no slot por fila (regresa null/undefined).
//   6. `renderRowActions` presente → invocado por cada member con el objeto
//      correcto + slot visible en cada `<li>`.

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

function setup(
  opts: {
    members?: Member[];
    renderRowActions?: (member: Member) => React.ReactNode;
  } = {},
) {
  return render(
    <MembersList
      members={opts.members ?? [FOUNDER, COOWNER, MEMBER]}
      labels={LABELS}
      renderRowActions={opts.renderRowActions}
    />,
  );
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

  it("`renderRowActions` ausente → no slot por fila (regresa null)", () => {
    setup();
    // Si no hay slot, no debe haber ningún testid `actions-slot`.
    expect(screen.queryByTestId(/actions-slot/)).not.toBeInTheDocument();
  });

  it("`renderRowActions` presente → invocado por cada member con shape correcto + slot visible", () => {
    const renderRowActions = vi.fn((member: Member) => (
      <span data-testid={`actions-slot-${member.handle}`}>
        slot:{member.handle}
      </span>
    ));
    setup({ renderRowActions });

    // Invocado exactamente 3 veces, una por member.
    expect(renderRowActions).toHaveBeenCalledTimes(3);
    expect(renderRowActions).toHaveBeenNthCalledWith(1, FOUNDER);
    expect(renderRowActions).toHaveBeenNthCalledWith(2, COOWNER);
    expect(renderRowActions).toHaveBeenNthCalledWith(3, MEMBER);

    // Slot renderizado por cada fila.
    expect(screen.getByTestId("actions-slot-alice")).toHaveTextContent(
      "slot:alice",
    );
    expect(screen.getByTestId("actions-slot-bob")).toHaveTextContent(
      "slot:bob",
    );
    expect(screen.getByTestId("actions-slot-carol")).toHaveTextContent(
      "slot:carol",
    );
  });
});
