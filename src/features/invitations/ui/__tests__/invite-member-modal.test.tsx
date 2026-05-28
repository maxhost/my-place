import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CreateInvitationResult } from "../../actions/create-invitation";
import {
  type InviteMemberModalLabels,
  InviteMemberModal,
} from "../invite-member-modal";

// Tests RTL de `<InviteMemberModal />` (capability-based invitation, spec
// §CU2). Seam-split: `createAction` inyectada como prop (tests `vi.fn()`;
// page S11 inyecta `createInvitationAction` real). Strings ES hardcoded —
// i18n extraction diferida a S11.

const LABELS: InviteMemberModalLabels = {
  title: "Invitar miembro",
  description:
    "El link es capability-based: cualquiera con este link puede unirse. Compartilo solo con la persona invitada.",
  emailLabel: "Email del invitado",
  emailPlaceholder: "ej@dominio.com",
  expiresLabel: "El link expira en (días)",
  submitButton: "Crear invitación",
  submitting: "Creando…",
  successHeading: "Listo — copiá el link y envialo",
  copyButton: "Copiar link",
  copiedTooltip: "¡Copiado!",
  closeButton: "Cerrar",
  errorInvalidEmail: "Email inválido.",
  errorInvalidExpires: "El plazo debe ser entre 1 y 90 días.",
  errorUnauthorized: "Necesitás iniciar sesión.",
  errorNotOwner: "Solo el owner del place puede invitar.",
  errorExpiresInPast: "La fecha de expiración quedó en el pasado.",
  errorRateLimited:
    "Demasiadas invitaciones en poco tiempo. Esperá un rato y volvé a intentar.",
  errorGeneric: "Algo salió mal. Probá de nuevo.",
};

function makeCreate(
  result: CreateInvitationResult = {
    ok: true,
    invitationId: "inv_1",
    token: "tok_abc",
  },
) {
  return vi.fn(async () => result);
}

function setup(
  opts: {
    createAction?: ReturnType<typeof makeCreate>;
    onClose?: () => void;
    inviteBaseUrl?: string;
  } = {},
) {
  const createAction = opts.createAction ?? makeCreate();
  const onClose = opts.onClose ?? vi.fn();
  const inviteBaseUrl = opts.inviteBaseUrl ?? "https://mi-club.place.community";
  const utils = render(
    <InviteMemberModal
      placeId="place_42"
      placeSlug="mi-club"
      inviteBaseUrl={inviteBaseUrl}
      createAction={createAction}
      onClose={onClose}
      labels={LABELS}
    />,
  );
  return { ...utils, createAction, onClose, inviteBaseUrl };
}

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    configurable: true,
    writable: true,
  });
});

describe("<InviteMemberModal />", () => {
  it("Abre con form visible: email + expiresInDays + submit", () => {
    setup();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Email del invitado")).toBeInTheDocument();
    expect(
      screen.getByLabelText("El link expira en (días)"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Crear invitación" }),
    ).toBeInTheDocument();
  });

  it("Submit válido invoca createAction con shape correcto + revela link copiable", async () => {
    const user = userEvent.setup();
    const createAction = makeCreate({
      ok: true,
      invitationId: "inv_99",
      token: "tok_xyz",
    });
    setup({ createAction });
    await user.type(screen.getByLabelText("Email del invitado"), "a@b.com");
    await user.click(screen.getByRole("button", { name: "Crear invitación" }));

    await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
    expect(createAction).toHaveBeenCalledWith(
      { placeId: "place_42", email: "a@b.com", expiresInDays: 7 },
      "mi-club",
    );
    expect(
      await screen.findByText("Listo — copiá el link y envialo"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("https://mi-club.place.community/invite/tok_xyz"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copiar link" }),
    ).toBeInTheDocument();
  });

  it("Click 'Copiar link' invoca navigator.clipboard.writeText + status '¡Copiado!'", async () => {
    const user = userEvent.setup();
    // Capturar el spy en variable local — `navigator.clipboard.writeText`
    // no preserva identidad de spy a través de Object.defineProperty
    // (mismo patrón usado en custom-domain interaction tests).
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    const createAction = makeCreate({
      ok: true,
      invitationId: "inv_99",
      token: "tok_xyz",
    });
    setup({ createAction });
    await user.type(screen.getByLabelText("Email del invitado"), "a@b.com");
    await user.click(screen.getByRole("button", { name: "Crear invitación" }));
    await screen.findByRole("button", { name: "Copiar link" });

    await user.click(screen.getByRole("button", { name: "Copiar link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(
      "https://mi-club.place.community/invite/tok_xyz",
    );
    expect(await screen.findByText("¡Copiado!")).toBeInTheDocument();
  });

  it("Email inválido ⇒ mensaje inline + action NO invocada", async () => {
    const user = userEvent.setup();
    const createAction = makeCreate();
    setup({ createAction });
    await user.type(screen.getByLabelText("Email del invitado"), "not-email");
    await user.click(screen.getByRole("button", { name: "Crear invitación" }));

    expect(await screen.findByText("Email inválido.")).toBeInTheDocument();
    expect(createAction).not.toHaveBeenCalled();
  });

  it("Action retorna error not_owner ⇒ feedback inline, modal sigue montado", async () => {
    const user = userEvent.setup();
    const createAction = makeCreate({ ok: false, error: "not_owner" });
    setup({ createAction });
    await user.type(screen.getByLabelText("Email del invitado"), "a@b.com");
    await user.click(screen.getByRole("button", { name: "Crear invitación" }));

    expect(
      await screen.findByText("Solo el owner del place puede invitar."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(createAction).toHaveBeenCalledTimes(1);
  });
});
