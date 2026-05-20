import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sidebar } from "../ui/sidebar";
import type { NavHubLabels } from "../ui/nav-hub-labels";

// Sidebar puro presentacional (Client Component): recibe `labels` y la sección
// activa, decide qué item resaltar y cuáles quedan disabled. V1 del Hub:
// "Tus lugares" navegable; "Mensajes" y "Actividad" siempre disabled con
// tooltip "Próximamente" (ADR pendiente: feature next-step de DMs/actividad).

const LABELS: NavHubLabels = {
  appName: "Place",
  sidebarPlaces: "Tus lugares",
  sidebarMessages: "Mensajes",
  sidebarActivity: "Actividad",
  comingSoon: "Próximamente",
  openMenu: "Abrir menú",
  closeMenu: "Cerrar menú",
  accountMenuButton: "Mi cuenta",
  accountMenuLogout: "Cerrar sesión",
  accountMenuLogoutPending: "Cerrando sesión…",
};

describe("Sidebar — items de navegación del hub", () => {
  it("renderea los 3 items del MVP con sus labels", () => {
    render(<Sidebar labels={LABELS} activeSection="places" />);
    expect(screen.getByText("Tus lugares")).toBeInTheDocument();
    expect(screen.getByText("Mensajes")).toBeInTheDocument();
    expect(screen.getByText("Actividad")).toBeInTheDocument();
  });

  it("el item activo tiene aria-current='page' (Tus lugares en V1)", () => {
    render(<Sidebar labels={LABELS} activeSection="places" />);
    const active = screen.getByRole("link", { name: /tus lugares/i });
    expect(active).toHaveAttribute("aria-current", "page");
  });

  it("los items 'Mensajes' y 'Actividad' son disabled + tooltip 'Próximamente'", () => {
    render(<Sidebar labels={LABELS} activeSection="places" />);
    // Cada uno debe quedar accesible como elemento pero NO como link
    // (sin `href` → no es <a> navegable; rol "link" sólo lo cumple "Tus lugares").
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1); // sólo "Tus lugares"
    expect(links[0]).toHaveTextContent("Tus lugares");

    // Los 2 disabled tienen aria-disabled + title (tooltip)
    const messages = screen.getByText("Mensajes").closest("[aria-disabled]");
    const activity = screen.getByText("Actividad").closest("[aria-disabled]");
    expect(messages).toHaveAttribute("aria-disabled", "true");
    expect(messages).toHaveAttribute("title", "Próximamente");
    expect(activity).toHaveAttribute("aria-disabled", "true");
    expect(activity).toHaveAttribute("title", "Próximamente");
  });

  it("el item 'Tus lugares' apunta al root del hub (href='/')", () => {
    render(<Sidebar labels={LABELS} activeSection="places" />);
    const places = screen.getByRole("link", { name: /tus lugares/i });
    expect(places).toHaveAttribute("href", "/");
  });
});
