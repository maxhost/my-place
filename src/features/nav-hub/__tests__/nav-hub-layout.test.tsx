import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NavHubLabels } from "../ui/nav-hub-labels";
import { NavHubLayout } from "../ui/nav-hub-layout";

// Tests del wrapper del Hub sobre el shell agnóstico (S4.b, ADR-0023).
// Tras la migración, `<NavHubLayout>` es un thin wrapper sobre `<AppShell>`:
// sólo cablea labels + items + activeSection. Los detalles del shell (drawer
// toggle, ESC, overlay, account menu, pending de logout) viven en
// `src/shared/ui/app-shell/__tests__/app-shell.test.tsx` — no se re-testean
// acá. Estos tests cubren la integración específica del Hub: que el wrapper
// pasa los items correctos al shell con el active key y el title bien
// mapeados.
//
// jsdom no computa media queries — assertions de responsive sobre clases
// Tailwind (paralelo al patrón del shell agnóstico).

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

describe("NavHubLayout — wrapper del Hub sobre el shell agnóstico", () => {
  it("renderea title del shell, 3 items del Hub, account menu y children", () => {
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
    // Title del shell (appName del Hub).
    expect(screen.getByText("Place")).toBeInTheDocument();
    // Account menu trigger.
    expect(
      screen.getByRole("button", { name: "Mi cuenta" }),
    ).toBeInTheDocument();
    // 3 items del Hub (`<nav aria-label={title}>` del shell).
    expect(
      screen.getByRole("navigation", { name: "Place" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tus lugares")).toBeInTheDocument();
    expect(screen.getByText("Mensajes")).toBeInTheDocument();
    expect(screen.getByText("Actividad")).toBeInTheDocument();
    // Children del main.
    expect(screen.getByText("contenido del hub")).toBeInTheDocument();
  });

  it("activeSection='places' → el item 'Tus lugares' es link con aria-current='page' y href='/'", () => {
    render(
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
    const active = screen.getByRole("link", { name: /tus lugares/i });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveAttribute("href", "/");
  });

  it("items 'Mensajes' y 'Actividad' son disabled (no son links, aria-disabled + tooltip)", () => {
    render(
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
    // Sólo "Tus lugares" es link (único item con href + sin disabled).
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Tus lugares");

    const messages = screen.getByText("Mensajes").closest("[aria-disabled]");
    const activity = screen.getByText("Actividad").closest("[aria-disabled]");
    expect(messages).toHaveAttribute("aria-disabled", "true");
    expect(messages).toHaveAttribute("title", "Próximamente");
    expect(activity).toHaveAttribute("aria-disabled", "true");
    expect(activity).toHaveAttribute("title", "Próximamente");
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
    // jsdom no resuelve la media query — alcanza con la clase como contract.
    // El <aside> desktop es el único aside del DOM cuando el drawer está
    // cerrado (drawer renderea su aside sólo al abrir).
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
