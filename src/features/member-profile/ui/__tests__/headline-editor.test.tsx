import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { UpdateMyHeadlineResult } from "../../actions/update-my-headline";
import {
  HeadlineEditor,
  type HeadlineEditorLabels,
} from "../headline-editor";

// Tests RTL de `<HeadlineEditor />` — Feature E V1 §S10 (tests.md §S10,
// spec §CU1 + ADR-0036). Editor inline self-only del headline contextual
// del miembro. Seam-split canónico: `updateAction` inyectada (tests
// `vi.fn()`; page S11 inyecta `updateMyHeadlineAction` real).
//
// **Branch crítico ADR-0036 §1**: `headline == null` + `isMe == false`
// ⇒ el componente NO renderea NADA (sin placeholder pasivo "Sin headline").
//
// Cobertura (5 casos, tests.md §S10):

const LABELS: HeadlineEditorLabels = {
  viewEditButton: "Editar",
  emptyCta: "Agregar headline",
  inputLabel: "Tu headline en este place",
  inputPlaceholder: "Contale a tu place quién sos acá",
  saveButton: "Guardar",
  cancelButton: "Cancelar",
  saving: "Guardando…",
  /** Template con `{count}` (longitud actual). Max fijo = 280. */
  counterTemplate: "{count}/280",
  errorTooLong: "Máximo 280 caracteres.",
  errorUnauthorized: "Necesitás iniciar sesión.",
  errorNotMember: "No formás parte de este place.",
  errorGeneric: "Algo salió mal. Probá de nuevo.",
};

function makeUpdate(
  result: UpdateMyHeadlineResult = { ok: true },
) {
  return vi.fn(async () => result);
}

function setup(opts: {
  currentHeadline: string | null;
  isMe: boolean;
  updateAction?: ReturnType<typeof makeUpdate>;
}) {
  const updateAction = opts.updateAction ?? makeUpdate();
  const utils = render(
    <HeadlineEditor
      placeId="place_42"
      placeSlug="mi-club"
      currentHeadline={opts.currentHeadline}
      isMe={opts.isMe}
      updateAction={updateAction}
      labels={LABELS}
    />,
  );
  return { ...utils, updateAction };
}

describe("<HeadlineEditor />", () => {
  it("Render con headline NOT NULL → texto visible + botón 'Editar'", () => {
    setup({ currentHeadline: "Recién en el barrio", isMe: true });
    expect(screen.getByText("Recién en el barrio")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Editar" }),
    ).toBeInTheDocument();
  });

  it("Render con headline NULL + isMe=true → CTA 'Agregar headline'", () => {
    setup({ currentHeadline: null, isMe: true });
    expect(
      screen.getByRole("button", { name: "Agregar headline" }),
    ).toBeInTheDocument();
  });

  it("Render con headline NULL + isMe=false → componente NO renderea (sin placeholder pasivo)", () => {
    const { container } = setup({ currentHeadline: null, isMe: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("Click 'Editar' → input visible con headline actual + counter '19/280'", async () => {
    const user = userEvent.setup();
    setup({ currentHeadline: "Recién en el barrio", isMe: true });
    await user.click(screen.getByRole("button", { name: "Editar" }));
    const input = screen.getByLabelText("Tu headline en este place");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("Recién en el barrio");
    expect(screen.getByText("19/280")).toBeInTheDocument();
  });

  it("Submit válido → invoca updateAction con shape correcto + UI post-success muestra texto editado", async () => {
    const user = userEvent.setup();
    const updateAction = makeUpdate({ ok: true });
    setup({ currentHeadline: null, isMe: true, updateAction });
    await user.click(
      screen.getByRole("button", { name: "Agregar headline" }),
    );
    const input = screen.getByLabelText("Tu headline en este place");
    await user.type(input, "Mi nuevo headline");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(updateAction).toHaveBeenCalledTimes(1),
    );
    expect(updateAction).toHaveBeenCalledWith(
      { placeId: "place_42", headline: "Mi nuevo headline" },
      "mi-club",
    );
    expect(
      await screen.findByText("Mi nuevo headline"),
    ).toBeInTheDocument();
  });
});
