import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu, type ContextMenuItem } from "./context-menu";

// Tests del ContextMenu genérico (S5 de Feature E members). Componente
// extraído del patrón inline en `app-shell/app-shell-account-menu.tsx:80-115`
// para que Feature E consuma dropdowns por-fila sin duplicar el behavior
// (toggle por trigger, click-outside vía mousedown, role=menu/menuitem,
// items con icon/destructive/disabled).
//
// Por qué `fireEvent.mouseDown(document.body)` para el click-outside: el
// listener del componente escucha `mousedown` (no `click`) — el patrón del
// account-menu cierra ANTES de que el target afuera dispare su propio
// onClick, lo que evita disparos accidentales en items ajenos al menú.

describe("ContextMenu — dropdown genérico activable por trigger", () => {
  function makeItems(overrides: Partial<ContextMenuItem>[] = []): ContextMenuItem[] {
    const base: ContextMenuItem[] = [
      { key: "edit", label: "Editar", onClick: vi.fn() },
      { key: "archive", label: "Archivar", onClick: vi.fn() },
    ];
    overrides.forEach((o, i) => {
      base[i] = { ...base[i], ...o };
    });
    return base;
  }

  it("render inicial: trigger visible y ningún menuitem en el DOM", () => {
    render(
      <ContextMenu
        triggerLabel="Acciones"
        trigger={<span aria-hidden="true">⋯</span>}
        items={makeItems()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Acciones" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("click trigger → items aparecen con el length correcto", async () => {
    const user = userEvent.setup();
    render(
      <ContextMenu
        triggerLabel="Acciones"
        trigger={<span aria-hidden="true">⋯</span>}
        items={makeItems()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Acciones" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Editar");
    expect(items[1]).toHaveTextContent("Archivar");
  });

  it("click item → su onClick invocado 1× y el menú cierra", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const items: ContextMenuItem[] = [
      { key: "edit", label: "Editar", onClick: onEdit },
      { key: "archive", label: "Archivar", onClick: vi.fn() },
    ];
    render(
      <ContextMenu
        triggerLabel="Acciones"
        trigger={<span aria-hidden="true">⋯</span>}
        items={items}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Acciones" }));
    await user.click(screen.getByRole("menuitem", { name: "Editar" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("click outside (mousedown en body) → menú cierra sin invocar items", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onArchive = vi.fn();
    const items: ContextMenuItem[] = [
      { key: "edit", label: "Editar", onClick: onEdit },
      { key: "archive", label: "Archivar", onClick: onArchive },
    ];
    render(
      <ContextMenu
        triggerLabel="Acciones"
        trigger={<span aria-hidden="true">⋯</span>}
        items={items}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Acciones" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    // El listener del componente escucha `mousedown` — replicamos exacto.
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("item con destructive=true → su button trae la clase visual destructiva", async () => {
    const user = userEvent.setup();
    const items: ContextMenuItem[] = [
      { key: "edit", label: "Editar", onClick: vi.fn() },
      {
        key: "delete",
        label: "Eliminar",
        onClick: vi.fn(),
        destructive: true,
      },
    ];
    render(
      <ContextMenu
        triggerLabel="Acciones"
        trigger={<span aria-hidden="true">⋯</span>}
        items={items}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Acciones" }));
    const deleteBtn = screen.getByRole("menuitem", { name: "Eliminar" });
    const editBtn = screen.getByRole("menuitem", { name: "Editar" });
    // Clase utilitaria local (no hay token --danger en el DS; el hook
    // semántico permite mapearlo cuando se agregue, sin tocar consumers).
    expect(deleteBtn.className).toContain("context-menu-item--destructive");
    expect(editBtn.className).not.toContain("context-menu-item--destructive");
  });

  it("item con icon ReactNode → el icon renderea junto al label", async () => {
    const user = userEvent.setup();
    const Icon = () => <svg data-testid="ctx-item-icon" />;
    const items: ContextMenuItem[] = [
      {
        key: "edit",
        label: "Editar",
        onClick: vi.fn(),
        icon: <Icon />,
      },
    ];
    render(
      <ContextMenu
        triggerLabel="Acciones"
        trigger={<span aria-hidden="true">⋯</span>}
        items={items}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Acciones" }));
    const icon = screen.getByTestId("ctx-item-icon");
    const item = screen.getByRole("menuitem", { name: "Editar" });
    // El icon vive dentro del button del item junto al label.
    expect(item).toContainElement(icon);
    expect(item).toHaveTextContent("Editar");
  });
});
