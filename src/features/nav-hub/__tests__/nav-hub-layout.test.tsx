import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NavHubLabels } from "../ui/nav-hub-labels";
import { NavHubLayout } from "../ui/nav-hub-layout";

// Tests del shell del hub (S3 del Hub V1). Layout responsivo: en desktop
// sidebar permanente a la izquierda + topbar; en mobile sidebar adentro del
// drawer + hamburger en topbar. jsdom no computa media queries, así que las
// assertions de responsive se hacen sobre las clases Tailwind (`hidden md:block`
// para la sidebar desktop; el hamburger del drawer queda siempre en el DOM —
// su visibilidad la controla CSS del parent del drawer).

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

describe("NavHubLayout — shell de navegación del hub", () => {
  it("renderea topbar (app name + drawer trigger + account button) + sidebar desktop + children", () => {
    render(
      <NavHubLayout
        labels={LABELS}
        displayName="Ana López"
        activeSection="places"
        onLogout={vi.fn()}
        navigate={vi.fn()}
      >
        <p>contenido del hub</p>
      </NavHubLayout>,
    );
    // Topbar
    expect(screen.getByText("Place")).toBeInTheDocument(); // app name
    expect(
      screen.getByRole("button", { name: "Abrir menú" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mi cuenta" }),
    ).toBeInTheDocument();
    // Sidebar (sólo aparece el aria-label una vez como nav porque el drawer
    // renderea su sidebar SÓLO cuando abre).
    expect(
      screen.getByRole("navigation", { name: "Place" }),
    ).toBeInTheDocument();
    // Children del main
    expect(screen.getByText("contenido del hub")).toBeInTheDocument();
  });

  it("la sidebar desktop tiene clases responsive 'hidden md:block' (visible sólo en md+)", () => {
    const { container } = render(
      <NavHubLayout
        labels={LABELS}
        displayName="Ana"
        activeSection="places"
        onLogout={vi.fn()}
        navigate={vi.fn()}
      >
        <p>x</p>
      </NavHubLayout>,
    );
    // La sidebar desktop se renderea adentro de un <aside>. Verificamos la
    // clase Tailwind responsive (jsdom no resuelve la media query — alcanza
    // con la clase presente como contract).
    const desktopAside = container.querySelector("aside");
    expect(desktopAside).not.toBeNull();
    expect(desktopAside?.className).toContain("hidden");
    expect(desktopAside?.className).toContain("md:block");
  });

  it("displayName 'Ana López' renderea iniciales 'AL' en el botón avatar", () => {
    render(
      <NavHubLayout
        labels={LABELS}
        displayName="Ana López"
        activeSection="places"
        onLogout={vi.fn()}
        navigate={vi.fn()}
      >
        <p>x</p>
      </NavHubLayout>,
    );
    const avatarBtn = screen.getByRole("button", { name: "Mi cuenta" });
    expect(avatarBtn).toHaveTextContent("AL");
  });

  it("displayName null → avatar muestra ícono fallback (sin iniciales)", () => {
    render(
      <NavHubLayout
        labels={LABELS}
        displayName={null}
        activeSection="places"
        onLogout={vi.fn()}
        navigate={vi.fn()}
      >
        <p>x</p>
      </NavHubLayout>,
    );
    const avatarBtn = screen.getByRole("button", { name: "Mi cuenta" });
    // Sin texto de iniciales: el botón contiene un SVG (aria-hidden) y nada más.
    expect(avatarBtn.textContent).toBe("");
    expect(avatarBtn.querySelector("svg")).not.toBeNull();
  });
});
