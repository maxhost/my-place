import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { RevokeInvitationResult } from "../../actions/revoke-invitation";
import type { PendingInvitation } from "../../types";
import {
  type PendingInvitationsTabLabels,
  PendingInvitationsTab,
} from "../pending-invitations-tab";

// Tests RTL de `<PendingInvitationsTab />` — listado de invitaciones pending
// + revoke con confirm (Feature E V1 §S9, spec §CU3). Seam-split canónico:
// `revokeAction` se inyecta como prop. Strings ES hardcoded — i18n S11.
//
// Cobertura (5 casos, tests.md §S9):
//   1. Lista N invitations: cada fila muestra email + caducidad + botón.
//   2. Array vacío ⇒ empty state visible.
//   3. Click "Revocar" ⇒ abre <ConfirmDialog> (shared/ui S5).
//   4. Confirm ⇒ invoca revokeAction(invitationId, placeSlug).
//   5. revokeAction error already_accepted ⇒ feedback inline + fila NO
//      desaparece (la revalidación post-success es responsabilidad del page
//      RSC; este componente NO hace mutación optimista V1).

const LABELS: PendingInvitationsTabLabels = {
  emptyTitle: "Sin invitaciones pendientes",
  emptyDescription: "Cuando invites a alguien, va a aparecer acá.",
  invitedByPrefix: "invitado por",
  expiresLabel: "Expira",
  revokeButton: "Revocar",
  confirmTitle: "Revocar invitación",
  confirmBody: "La invitación a {email} dejará de funcionar inmediatamente.",
  confirmYes: "Sí, revocar",
  confirmNo: "Cancelar",
  errorUnauthorized: "Necesitás iniciar sesión.",
  errorNotOwner: "Solo el owner del place puede revocar.",
  errorNotFound: "La invitación ya no existe.",
  errorAlreadyAccepted:
    "Esa invitación ya fue aceptada — usá 'remover miembro' para sacar a la persona.",
  errorGeneric: "Algo salió mal. Probá de nuevo.",
};

function makeRevoke(result: RevokeInvitationResult = { ok: true }) {
  return vi.fn(async () => result);
}

const FIXTURES: PendingInvitation[] = [
  {
    invitationId: "inv_a",
    email: "alice@x.com",
    expiresAt: new Date("2026-06-01T00:00:00.000Z"),
    invitedByDisplayName: "Bob Founder",
  },
  {
    invitationId: "inv_b",
    email: "carol@x.com",
    expiresAt: new Date("2026-06-15T00:00:00.000Z"),
    invitedByDisplayName: "Bob Founder",
  },
];

function setup(
  opts: {
    invitations?: PendingInvitation[];
    revokeAction?: ReturnType<typeof makeRevoke>;
  } = {},
) {
  const invitations = opts.invitations ?? FIXTURES;
  const revokeAction = opts.revokeAction ?? makeRevoke();
  const utils = render(
    <PendingInvitationsTab
      invitations={invitations}
      placeSlug="mi-club"
      revokeAction={revokeAction}
      labels={LABELS}
    />,
  );
  return { ...utils, revokeAction, invitations };
}

describe("<PendingInvitationsTab />", () => {
  it("Renderiza una fila por invitación con email + invitedBy + botón Revocar", () => {
    setup();
    expect(screen.getByText("alice@x.com")).toBeInTheDocument();
    expect(screen.getByText("carol@x.com")).toBeInTheDocument();
    // 'invitado por Bob Founder' aparece en cada fila
    expect(screen.getAllByText(/invitado por Bob Founder/)).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Revocar" }),
    ).toHaveLength(2);
  });

  it("Array vacío ⇒ empty state visible", () => {
    setup({ invitations: [] });
    expect(
      screen.getByText("Sin invitaciones pendientes"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Cuando invites a alguien, va a aparecer acá."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revocar" })).toBeNull();
  });

  it("Click 'Revocar' abre ConfirmDialog con email interpolado en el body", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(
      screen.getAllByRole("button", { name: "Revocar" })[0]!,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText(
        "La invitación a alice@x.com dejará de funcionar inmediatamente.",
      ),
    ).toBeInTheDocument();
  });

  it("Confirm invoca revokeAction({invitationId}, placeSlug) 1 vez", async () => {
    const user = userEvent.setup();
    const revokeAction = makeRevoke();
    setup({ revokeAction });
    await user.click(
      screen.getAllByRole("button", { name: "Revocar" })[0]!,
    );
    await user.click(screen.getByRole("button", { name: "Sí, revocar" }));

    await waitFor(() => expect(revokeAction).toHaveBeenCalledTimes(1));
    expect(revokeAction).toHaveBeenCalledWith(
      { invitationId: "inv_a" },
      "mi-club",
    );
  });

  it("Action error already_accepted ⇒ feedback inline + fila sigue visible", async () => {
    const user = userEvent.setup();
    const revokeAction = makeRevoke({ ok: false, error: "already_accepted" });
    setup({ revokeAction });
    await user.click(
      screen.getAllByRole("button", { name: "Revocar" })[0]!,
    );
    await user.click(screen.getByRole("button", { name: "Sí, revocar" }));

    expect(
      await screen.findByText(
        "Esa invitación ya fue aceptada — usá 'remover miembro' para sacar a la persona.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("alice@x.com")).toBeInTheDocument();
  });
});
