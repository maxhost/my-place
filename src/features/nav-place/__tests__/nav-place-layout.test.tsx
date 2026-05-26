import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NavPlaceLabels } from "../ui/nav-place-labels";
import { NavPlaceLayout } from "../ui/nav-place-layout";

// Tests del wrapper del settings sobre el shell agnóstico (V1.1, ADR-0025).
// `<NavPlaceLayout>` es un thin wrapper sobre `<AppShell>`: cablea labels +
// 4 grupos conceptuales + 9 items del settings + active section. Los
// detalles del shell (drawer toggle, ESC, overlay, account menu, pending de
// logout, render de heading <h2> por grupo, render de item disabled vs
// link activo) viven en
// `src/shared/ui/app-shell/__tests__/app-shell.test.tsx` — no se re-testean
// acá. Estos tests cubren la integración específica de la zona settings:
// que el wrapper arme los 4 grupos en orden con los 9 items correctos,
// los iconos iconoir cableados, y las 2 secciones navegables ("language"
// + "domain", custom-domain V1 ADR-0026) vs los 7 items aún disabled.
//
// jsdom no computa media queries — assertions de responsive sobre clases
// Tailwind (paralelo al patrón del shell agnóstico).

const LABELS: NavPlaceLabels = {
  title: "Configurar tu lugar",
  // 4 group labels (V1.1, ADR-0025).
  groupIdentity: "Identidad",
  groupStructure: "Estructura",
  groupSubscription: "Suscripción",
  groupManagement: "Gestión",
  // 9 item labels (V1.1 = V1 6 + 3 nuevos: zones/groups/tiers).
  sidebarLanguage: "Idioma del place",
  sidebarMembers: "Miembros",
  sidebarAppearance: "Apariencia",
  sidebarHours: "Horario",
  sidebarBilling: "Billing",
  sidebarDomain: "Dominio",
  sidebarZones: "Zonas",
  sidebarGroups: "Grupos",
  sidebarTiers: "Tiers",
  comingSoon: "Próximamente",
  openMenu: "Abrir menú",
  closeMenu: "Cerrar menú",
  accountMenuButton: "Mi cuenta",
  accountMenuLogout: "Cerrar sesión",
  accountMenuLogoutPending: "Cerrando sesión…",
};

describe("NavPlaceLayout — wrapper del settings agrupado V1.1 (ADR-0025)", () => {
  it("renderea title del shell, 4 group headings, 9 items del settings, account menu y children", () => {
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
    // `<nav aria-label={title}>` del shell — un solo nav.
    expect(
      screen.getByRole("navigation", { name: "Configurar tu lugar" }),
    ).toBeInTheDocument();
    // 4 group headings <h2>.
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      "Identidad",
      "Estructura",
      "Suscripción",
      "Gestión",
    ]);
    // 9 items por sus labels.
    for (const text of [
      "Apariencia",
      "Idioma del place",
      "Dominio",
      "Zonas",
      "Horario",
      "Billing",
      "Miembros",
      "Grupos",
      "Tiers",
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
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

  it("activeSection='language' → 'Dominio' renderea como link a /settings/domain (V1.1 custom-domain, ADR-0026); los 7 items restantes (appearance/zones/hours/billing/members/groups/tiers) son disabled — aria-disabled + tooltip 'Próximamente', sin role link", () => {
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
    // 3 links: "Idioma del place" (active) + "Dominio" + "Miembros"
    // (todas navegables; sólo Idioma está activa con activeSection="language").
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links.map((l) => l.textContent)).toEqual([
      "Idioma del place",
      "Dominio",
      "Miembros",
    ]);
    // Idioma: aria-current="page" (active) + href "/settings".
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(links[0]).toHaveAttribute("href", "/settings");
    // Dominio: navegable pero NO active → sin aria-current="page", href subdomain.
    expect(links[1]).not.toHaveAttribute("aria-current", "page");
    expect(links[1]).toHaveAttribute("href", "/settings/domain");
    // Miembros (Feature E S11): navegable pero NO active → sin aria-current.
    expect(links[2]).not.toHaveAttribute("aria-current", "page");
    expect(links[2]).toHaveAttribute("href", "/settings/members");

    const disabledLabels = [
      "Apariencia",
      "Zonas",
      "Horario",
      "Billing",
      "Grupos",
      "Tiers",
    ];
    for (const label of disabledLabels) {
      const node = screen.getByText(label).closest("[aria-disabled]");
      expect(node).toHaveAttribute("aria-disabled", "true");
      expect(node).toHaveAttribute("title", "Próximamente");
    }
  });

  it("las 3 items NUEVAS V1.1 (Zonas, Grupos, Tiers) aparecen en sus grupos correctos (Estructura · Gestión · Gestión)", () => {
    // Test específico del refactor V1.1: garantizar que los 3 items nuevos
    // se rendean dentro del grupo conceptual correcto, no sueltos. Hace
    // assertion sobre la estructura DOM `<div>` por grupo del shell.
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
    // El shell renderea `<nav><div>{group1}</div><div>{group2}</div>...</nav>`.
    // Cada `<div>` empieza con `<h2>` (el label del grupo) seguido de items.
    const nav = container.querySelector('nav[aria-label="Configurar tu lugar"]');
    expect(nav).not.toBeNull();
    const groupDivs = nav!.querySelectorAll(":scope > div");
    expect(groupDivs).toHaveLength(4);

    // Grupo 2 = Estructura → contiene Zonas + Horario.
    expect(
      within(groupDivs[1] as HTMLElement).getByText("Estructura"),
    ).toBeInTheDocument();
    expect(
      within(groupDivs[1] as HTMLElement).getByText("Zonas"),
    ).toBeInTheDocument();
    expect(
      within(groupDivs[1] as HTMLElement).getByText("Horario"),
    ).toBeInTheDocument();

    // Grupo 4 = Gestión → contiene Miembros + Grupos + Tiers.
    expect(
      within(groupDivs[3] as HTMLElement).getByText("Gestión"),
    ).toBeInTheDocument();
    expect(
      within(groupDivs[3] as HTMLElement).getByText("Miembros"),
    ).toBeInTheDocument();
    expect(
      within(groupDivs[3] as HTMLElement).getByText("Grupos"),
    ).toBeInTheDocument();
    expect(
      within(groupDivs[3] as HTMLElement).getByText("Tiers"),
    ).toBeInTheDocument();
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
