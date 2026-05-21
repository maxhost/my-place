import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NavPlaceLabels } from "../ui/nav-place-labels";
import { NavPlaceLayout } from "../ui/nav-place-layout";

// Tests del wrapper del settings sobre el shell agnóstico (S5, ADR-0023).
// `<NavPlaceLayout>` es un thin wrapper sobre `<AppShell>` paralelo a
// `<NavHubLayout>`: sólo cablea labels + 6 items del settings + active
// section. Los detalles del shell (drawer toggle, ESC, overlay, account
// menu, pending de logout) viven en
// `src/shared/ui/app-shell/__tests__/app-shell.test.tsx` (S4.a) — no se
// re-testean acá. Estos tests cubren la integración específica de la zona
// settings: que el wrapper pasa los 6 items correctos al shell con el
// active key y el title bien mapeados (1 navegable "language" + 5
// disabled).
//
// jsdom no computa media queries — assertions de responsive sobre clases
// Tailwind (paralelo al patrón del shell agnóstico).

const LABELS: NavPlaceLabels = {
  title: "Configurar tu lugar",
  sidebarLanguage: "Idioma del place",
  sidebarMembers: "Miembros",
  sidebarAppearance: "Apariencia",
  sidebarHours: "Horario",
  sidebarBilling: "Billing",
  sidebarDomain: "Dominio custom",
  comingSoon: "Próximamente",
  openMenu: "Abrir menú",
  closeMenu: "Cerrar menú",
  accountMenuButton: "Mi cuenta",
  accountMenuLogout: "Cerrar sesión",
  accountMenuLogoutPending: "Cerrando sesión…",
};

describe("NavPlaceLayout — wrapper del settings sobre el shell agnóstico", () => {
  it("renderea title del shell, 6 items del settings, account menu y children", () => {
    render(
      <NavPlaceLayout
        labels={LABELS}
        displayName="Ana López"
        activeSection="language"
        onLogout={vi.fn()}
        navigate={vi.fn()}
      >
        <p>contenido del settings</p>
      </NavPlaceLayout>,
    );
    // Title del shell (= labels.title del settings).
    expect(screen.getByText("Configurar tu lugar")).toBeInTheDocument();
    // Account menu trigger.
    expect(
      screen.getByRole("button", { name: "Mi cuenta" }),
    ).toBeInTheDocument();
    // 6 items del settings (`<nav aria-label={title}>` del shell).
    expect(
      screen.getByRole("navigation", { name: "Configurar tu lugar" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Idioma del place")).toBeInTheDocument();
    expect(screen.getByText("Miembros")).toBeInTheDocument();
    expect(screen.getByText("Apariencia")).toBeInTheDocument();
    expect(screen.getByText("Horario")).toBeInTheDocument();
    expect(screen.getByText("Billing")).toBeInTheDocument();
    expect(screen.getByText("Dominio custom")).toBeInTheDocument();
    // Children del main.
    expect(screen.getByText("contenido del settings")).toBeInTheDocument();
  });

  it("activeSection='language' → el item 'Idioma del place' es link con aria-current='page' y href='/settings'", () => {
    render(
      <NavPlaceLayout
        labels={LABELS}
        displayName="Ana"
        activeSection="language"
        onLogout={vi.fn()}
        navigate={vi.fn()}
      >
        <p>x</p>
      </NavPlaceLayout>,
    );
    const active = screen.getByRole("link", { name: /idioma del place/i });
    expect(active).toHaveAttribute("aria-current", "page");
    // URL canónica del settings: `{slug}.place.community/settings` — el slug
    // está en el subdomain, no en el path (feedback_urls_subdomain).
    expect(active).toHaveAttribute("href", "/settings");
  });

  it("los 5 items restantes (members/appearance/hours/billing/domain) son disabled (no son links, aria-disabled + tooltip)", () => {
    render(
      <NavPlaceLayout
        labels={LABELS}
        displayName="Ana"
        activeSection="language"
        onLogout={vi.fn()}
        navigate={vi.fn()}
      >
        <p>x</p>
      </NavPlaceLayout>,
    );
    // Sólo "Idioma del place" es link (único item con href + sin disabled).
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Idioma del place");

    const members = screen.getByText("Miembros").closest("[aria-disabled]");
    const appearance = screen
      .getByText("Apariencia")
      .closest("[aria-disabled]");
    const hours = screen.getByText("Horario").closest("[aria-disabled]");
    const billing = screen.getByText("Billing").closest("[aria-disabled]");
    const domain = screen
      .getByText("Dominio custom")
      .closest("[aria-disabled]");

    for (const item of [members, appearance, hours, billing, domain]) {
      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(item).toHaveAttribute("title", "Próximamente");
    }
  });

  it("la sidebar desktop tiene clases responsive 'hidden md:block' (visible sólo en md+)", () => {
    const { container } = render(
      <NavPlaceLayout
        labels={LABELS}
        displayName="Ana"
        activeSection="language"
        onLogout={vi.fn()}
        navigate={vi.fn()}
      >
        <p>x</p>
      </NavPlaceLayout>,
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
      <NavPlaceLayout
        labels={LABELS}
        displayName="Ana López"
        activeSection="language"
        onLogout={vi.fn()}
        navigate={vi.fn()}
      >
        <p>x</p>
      </NavPlaceLayout>,
    );
    const avatarBtn = screen.getByRole("button", { name: "Mi cuenta" });
    expect(avatarBtn).toHaveTextContent("AL");
  });

  it("displayName null → avatar muestra ícono fallback (sin iniciales)", () => {
    render(
      <NavPlaceLayout
        labels={LABELS}
        displayName={null}
        activeSection="language"
        onLogout={vi.fn()}
        navigate={vi.fn()}
      >
        <p>x</p>
      </NavPlaceLayout>,
    );
    const avatarBtn = screen.getByRole("button", { name: "Mi cuenta" });
    // Sin texto de iniciales: el botón contiene un SVG (aria-hidden) y nada más.
    expect(avatarBtn.textContent).toBe("");
    expect(avatarBtn.querySelector("svg")).not.toBeNull();
  });
});
