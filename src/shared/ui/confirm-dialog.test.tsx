import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";

// Tests del ConfirmDialog genérico shared/ui (S5 de Feature E). Componente
// extraído de la semántica del inline en
// `features/custom-domain/ui/domain-section-archive.tsx:109-165` — V1 NO
// refactorea ese consumidor (queda como precedente histórico), pero la API
// queda canónica para Feature E y futuros usos.
//
// El dialog usa `<div role="dialog">` (en vez de `<dialog>` HTML nativo)
// porque jsdom no implementa `showModal()` de forma confiable; ese trade-off
// está documentado en el precedente y se mantiene acá.

const BASE_PROPS = {
  title: "¿Eliminar miembro?",
  description: "Esta acción no se puede deshacer.",
  confirmLabel: "Eliminar",
  cancelLabel: "Cancelar",
};

describe("ConfirmDialog — dialog genérico con confirm/cancel", () => {
  it("open=false → no renderea nada en el DOM", () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        {...BASE_PROPS}
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("open=true → renderea title, description, confirmLabel y cancelLabel visibles", () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        {...BASE_PROPS}
      />,
    );
    expect(screen.getByText("¿Eliminar miembro?")).toBeInTheDocument();
    expect(
      screen.getByText("Esta acción no se puede deshacer."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Eliminar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancelar" }),
    ).toBeInTheDocument();
  });

  it("click confirm → invoca onConfirm 1×", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        onClose={onClose}
        onConfirm={onConfirm}
        {...BASE_PROPS}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("click cancel → invoca onClose, onConfirm NO se invoca", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        onClose={onClose}
        onConfirm={onConfirm}
        {...BASE_PROPS}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("destructive=true → el botón confirm tiene clase visual distintiva 'cta-destructive'", () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        destructive
        {...BASE_PROPS}
      />,
    );
    const confirmButton = screen.getByRole("button", { name: "Eliminar" });
    // Token visual distintivo: la clase semántica `cta-destructive` se aplica
    // sólo en este modo. Mapea internamente a `--accent-strong` (token DS).
    expect(confirmButton.className).toContain("cta-destructive");
  });

  it("ARIA: el dialog tiene role='dialog' + aria-modal='true' y el confirm recibe foco inicial", () => {
    render(
      <ConfirmDialog
        open={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        {...BASE_PROPS}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // autoFocus inicial sobre el confirm — el usuario puede confirmar con
    // Enter sin tabbear. Mismo patrón del precedente custom-domain.
    const confirmButton = screen.getByRole("button", { name: "Eliminar" });
    expect(document.activeElement).toBe(confirmButton);
  });
});
