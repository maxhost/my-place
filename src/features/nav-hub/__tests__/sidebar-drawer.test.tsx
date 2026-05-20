import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SidebarDrawer } from "../ui/sidebar-drawer";

// Tests del drawer mobile (S3 del Hub V1). Wrapper Client que envuelve cualquier
// contenido y lo muestra como aside fija cuando el user toca el hamburger.
// V1 sólo se usa para envolver el `<Sidebar />`, pero el componente es
// agnóstico (cualquier ReactNode como children).
//
// Toggle: useState interno (compose-friendly — el parent no necesita gobernar
// el state). Cierre: overlay click + ESC. Touch target hamburger ≥44×44
// (clase Tailwind `min-h-11 min-w-11`; jsdom no computa layout, sólo se
// verifica la clase). El visibility responsive (hidden en md+) lo controla
// el parent vía la prop `className` del wrapper externo.

describe("SidebarDrawer — toggle del drawer mobile", () => {
  it("por default está cerrado: hamburger visible, panel NO en DOM, overlay NO en DOM", () => {
    render(
      <SidebarDrawer
        openLabel="Abrir menú"
        closeLabel="Cerrar menú"
        dialogLabel="Navegación"
      >
        <p>contenido drawer</p>
      </SidebarDrawer>,
    );
    // Hamburger button siempre renderizado (visibilidad responsive es CSS del parent)
    expect(screen.getByRole("button", { name: "Abrir menú" })).toBeInTheDocument();
    // Panel + overlay NO en DOM
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("drawer-overlay")).not.toBeInTheDocument();
    // El children tampoco está renderizado (se monta sólo cuando abre)
    expect(screen.queryByText("contenido drawer")).not.toBeInTheDocument();
  });

  it("click hamburger abre el drawer: panel y overlay aparecen + children visible", async () => {
    const user = userEvent.setup();
    render(
      <SidebarDrawer
        openLabel="Abrir menú"
        closeLabel="Cerrar menú"
        dialogLabel="Navegación"
      >
        <p>contenido drawer</p>
      </SidebarDrawer>,
    );
    await user.click(screen.getByRole("button", { name: "Abrir menú" }));
    expect(screen.getByRole("dialog", { name: "Navegación" })).toBeInTheDocument();
    expect(screen.getByTestId("drawer-overlay")).toBeInTheDocument();
    expect(screen.getByText("contenido drawer")).toBeInTheDocument();
  });

  it("click en overlay cierra el drawer", async () => {
    const user = userEvent.setup();
    render(
      <SidebarDrawer
        openLabel="Abrir menú"
        closeLabel="Cerrar menú"
        dialogLabel="Navegación"
      >
        <p>contenido drawer</p>
      </SidebarDrawer>,
    );
    await user.click(screen.getByRole("button", { name: "Abrir menú" }));
    await user.click(screen.getByTestId("drawer-overlay"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("tecla ESC cierra el drawer", async () => {
    const user = userEvent.setup();
    render(
      <SidebarDrawer
        openLabel="Abrir menú"
        closeLabel="Cerrar menú"
        dialogLabel="Navegación"
      >
        <p>contenido drawer</p>
      </SidebarDrawer>,
    );
    await user.click(screen.getByRole("button", { name: "Abrir menú" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("botón hamburger tiene touch target ≥44×44 (clase min-h-11 min-w-11)", () => {
    render(
      <SidebarDrawer
        openLabel="Abrir menú"
        closeLabel="Cerrar menú"
        dialogLabel="Navegación"
      >
        <p>contenido drawer</p>
      </SidebarDrawer>,
    );
    const trigger = screen.getByRole("button", { name: "Abrir menú" });
    // jsdom no computa layout; verificamos la clase Tailwind (2.75rem = 44px).
    expect(trigger.className).toContain("min-h-11");
    expect(trigger.className).toContain("min-w-11");
  });

  it("botón de cierre dentro del drawer también cierra", async () => {
    const user = userEvent.setup();
    render(
      <SidebarDrawer
        openLabel="Abrir menú"
        closeLabel="Cerrar menú"
        dialogLabel="Navegación"
      >
        <p>contenido drawer</p>
      </SidebarDrawer>,
    );
    await user.click(screen.getByRole("button", { name: "Abrir menú" }));
    await user.click(screen.getByRole("button", { name: "Cerrar menú" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
