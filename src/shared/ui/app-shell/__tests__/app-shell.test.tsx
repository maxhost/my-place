import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  AppShell,
  type AppShellLabels,
  type SidebarItem,
} from "../public";

// `sidebarGroups` es el contract canónico post-ADR-0025: el shell acepta
// agrupaciones (`SidebarGroup = { label: string | null; items: SidebarItem[] }`)
// y renderea un `<h2>` fijo (no-colapsable) por grupo cuando `label !== null`.
// Para los tests que sólo cubren behavior agnóstico al agrupamiento, los
// items se pasan como un único grupo "plano" (`label: null`) — equivale al
// uso de `nav-hub` V1 (que arma todos sus items en un solo bag sin header).

// Tests del shell agnóstico (S4.a del feature `settings`, ADR-0023). Cubren
// el contract reusable: render de items (activos, navegables, disabled),
// drawer mobile (toggle + cierres), account menu (trigger + logout flow),
// invariante acíclico shared←features (verificable por grep + assertion
// del módulo). Los detalles del Hub V1 (qué items concretos pasa nav-hub
// al shell) se cubren en `nav-hub/__tests__/nav-hub-layout.test.tsx`
// (regresión en S4.b).
//
// Por qué tests sobre el shell agnóstico (no sobre el Hub): el shell es
// reusado por `nav-place` desde S5; un bug acá rompe ambas zonas. Tener
// la cobertura acá hace que "lo que cambia junto vive junto" (ADR-0023
// §"Alternativas rechazadas") tenga test backing.
//
// jsdom no computa media queries: las assertions de responsive se hacen
// sobre las clases Tailwind (`hidden md:block` para el aside desktop;
// `md:hidden` para el wrapper del hamburger), no sobre layout efectivo.

const LABELS: AppShellLabels = {
  comingSoon: "Próximamente",
  openMenu: "Abrir menú",
  closeMenu: "Cerrar menú",
  accountMenuButton: "Mi cuenta",
  accountMenuLogout: "Cerrar sesión",
  accountMenuLogoutPending: "Cerrando sesión…",
};

const ITEMS_BASE: SidebarItem[] = [
  { key: "home", label: "Inicio", href: "/" },
  { key: "messages", label: "Mensajes", disabled: true },
  { key: "activity", label: "Actividad", disabled: true },
];

describe("AppShell — shell agnóstico mobile-first (ADR-0023)", () => {
  it("renderea title, items del sidebar, account menu y children", () => {
    render(
      <AppShell
        title="Hub"
        sidebarGroups={[{ label: null, items: ITEMS_BASE }]}
        activeKey="home"
        displayName="Ana López"
        onLogout={vi.fn()}
        navigate={vi.fn()}
        labels={LABELS}
      >
        <p>contenido principal</p>
      </AppShell>,
    );
    expect(screen.getByText("Hub")).toBeInTheDocument();
    expect(screen.getByText("Inicio")).toBeInTheDocument();
    expect(screen.getByText("Mensajes")).toBeInTheDocument();
    expect(screen.getByText("Actividad")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mi cuenta" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Abrir menú" }),
    ).toBeInTheDocument();
    expect(screen.getByText("contenido principal")).toBeInTheDocument();
    // `<nav aria-label={title}>` para que AT identifique la región.
    expect(
      screen.getByRole("navigation", { name: "Hub" }),
    ).toBeInTheDocument();
  });

  it("el item con key === activeKey tiene aria-current='page'", () => {
    render(
      <AppShell
        title="Hub"
        sidebarGroups={[{ label: null, items: ITEMS_BASE }]}
        activeKey="home"
        displayName="Ana"
        onLogout={vi.fn()}
        navigate={vi.fn()}
        labels={LABELS}
      >
        <p>x</p>
      </AppShell>,
    );
    const active = screen.getByRole("link", { name: /inicio/i });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveAttribute("href", "/");
  });

  it("items con disabled=true tienen aria-disabled + title=comingSoon y NO son links", () => {
    render(
      <AppShell
        title="Hub"
        sidebarGroups={[{ label: null, items: ITEMS_BASE }]}
        activeKey="home"
        displayName="Ana"
        onLogout={vi.fn()}
        navigate={vi.fn()}
        labels={LABELS}
      >
        <p>x</p>
      </AppShell>,
    );
    // Sólo "Inicio" es link (el único con href + sin disabled).
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Inicio");

    const messages = screen.getByText("Mensajes").closest("[aria-disabled]");
    const activity = screen.getByText("Actividad").closest("[aria-disabled]");
    expect(messages).toHaveAttribute("aria-disabled", "true");
    expect(messages).toHaveAttribute("title", "Próximamente");
    expect(activity).toHaveAttribute("aria-disabled", "true");
    expect(activity).toHaveAttribute("title", "Próximamente");
  });

  it("la sidebar desktop tiene clases responsive 'hidden md:block'", () => {
    const { container } = render(
      <AppShell
        title="Hub"
        sidebarGroups={[{ label: null, items: ITEMS_BASE }]}
        activeKey="home"
        displayName="Ana"
        onLogout={vi.fn()}
        navigate={vi.fn()}
        labels={LABELS}
      >
        <p>x</p>
      </AppShell>,
    );
    // jsdom no resuelve la media query — alcanza con la clase como contract.
    // El <aside> desktop es el primer aside del DOM (el drawer aside sólo
    // existe cuando está abierto).
    const desktopAside = container.querySelector("aside");
    expect(desktopAside).not.toBeNull();
    expect(desktopAside?.className).toContain("hidden");
    expect(desktopAside?.className).toContain("md:block");
  });

  it("click hamburger abre drawer con el sidebar adentro; overlay cierra", async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        title="Hub"
        sidebarGroups={[{ label: null, items: ITEMS_BASE }]}
        activeKey="home"
        displayName="Ana"
        onLogout={vi.fn()}
        navigate={vi.fn()}
        labels={LABELS}
      >
        <p>x</p>
      </AppShell>,
    );
    // Pre-open: dialog NO en DOM.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Abrir menú" }));
    // Post-open: dialog con aria-label = title + overlay testeable.
    expect(
      screen.getByRole("dialog", { name: "Hub" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("drawer-overlay")).toBeInTheDocument();
    // Al abrir, el sidebar aparece DUPLICADO (desktop hidden + dentro del
    // drawer). El item "Inicio" pasa a verse 2x en el DOM.
    expect(screen.getAllByText("Inicio")).toHaveLength(2);
    // Cierre por overlay.
    await user.click(screen.getByTestId("drawer-overlay"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("tecla ESC cierra el drawer abierto", async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        title="Hub"
        sidebarGroups={[{ label: null, items: ITEMS_BASE }]}
        activeKey="home"
        displayName="Ana"
        onLogout={vi.fn()}
        navigate={vi.fn()}
        labels={LABELS}
      >
        <p>x</p>
      </AppShell>,
    );
    await user.click(screen.getByRole("button", { name: "Abrir menú" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("displayName 'Ana López' renderea iniciales 'AL' en el avatar", () => {
    render(
      <AppShell
        title="Hub"
        sidebarGroups={[{ label: null, items: ITEMS_BASE }]}
        activeKey="home"
        displayName="Ana López"
        onLogout={vi.fn()}
        navigate={vi.fn()}
        labels={LABELS}
      >
        <p>x</p>
      </AppShell>,
    );
    const avatarBtn = screen.getByRole("button", { name: "Mi cuenta" });
    expect(avatarBtn).toHaveTextContent("AL");
  });

  it("displayName null → avatar muestra ícono fallback (sin iniciales)", () => {
    render(
      <AppShell
        title="Hub"
        sidebarGroups={[{ label: null, items: ITEMS_BASE }]}
        activeKey="home"
        displayName={null}
        onLogout={vi.fn()}
        navigate={vi.fn()}
        labels={LABELS}
      >
        <p>x</p>
      </AppShell>,
    );
    const avatarBtn = screen.getByRole("button", { name: "Mi cuenta" });
    expect(avatarBtn.textContent).toBe("");
    expect(avatarBtn.querySelector("svg")).not.toBeNull();
  });

  it("click avatar abre el menú con item de logout; click logout invoca onLogout + navigate", async () => {
    const user = userEvent.setup();
    const onLogout = vi
      .fn()
      .mockResolvedValue({ redirectTo: "https://place.community/es/" });
    const navigate = vi.fn();
    render(
      <AppShell
        title="Hub"
        sidebarGroups={[{ label: null, items: ITEMS_BASE }]}
        activeKey="home"
        displayName="Ana"
        onLogout={onLogout}
        navigate={navigate}
        labels={LABELS}
      >
        <p>x</p>
      </AppShell>,
    );
    await user.click(screen.getByRole("button", { name: "Mi cuenta" }));
    const logoutItem = screen.getByRole("menuitem", {
      name: /cerrar sesión/i,
    });
    expect(logoutItem).toBeInTheDocument();
    await user.click(logoutItem);
    expect(onLogout).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("https://place.community/es/"),
    );
  });

  it("muestra el label pending del logout mientras la action está en vuelo", async () => {
    const user = userEvent.setup();
    let resolveLogout: (value: { redirectTo: string }) => void = () => {};
    const onLogout = vi.fn(
      () =>
        new Promise<{ redirectTo: string }>((resolve) => {
          resolveLogout = resolve;
        }),
    );
    render(
      <AppShell
        title="Hub"
        sidebarGroups={[{ label: null, items: ITEMS_BASE }]}
        activeKey="home"
        displayName="Ana"
        onLogout={onLogout}
        navigate={vi.fn()}
        labels={LABELS}
      >
        <p>x</p>
      </AppShell>,
    );
    await user.click(screen.getByRole("button", { name: "Mi cuenta" }));
    await user.click(
      screen.getByRole("menuitem", { name: /cerrar sesión/i }),
    );
    const pendingItem = await screen.findByRole("menuitem", {
      name: /cerrando sesión/i,
    });
    expect(pendingItem).toHaveAttribute("aria-disabled", "true");
    // Liberamos la promesa para evitar timers colgando entre tests.
    resolveLogout({ redirectTo: "https://place.community/es/" });
  });

  it("icon: ReactNode renderiza dentro de un wrapper aria-hidden (tanto en items navegables como disabled)", () => {
    // Regresión del contrato post-ADR-0025: `SidebarItem.icon` es `ReactNode`
    // (no string/emoji). Cualquier componente React válido —SVG inline,
    // `iconoir-react`, etc.— se renderea dentro de un span `aria-hidden` que
    // hereda color del texto. El shell NO conoce el origen del ícono.
    const ItemIcon = () => <svg data-testid="item-icon-active" />;
    const DisabledIcon = () => <svg data-testid="item-icon-disabled" />;
    render(
      <AppShell
        title="Hub"
        sidebarGroups={[
          {
            label: null,
            items: [
              { key: "home", label: "Inicio", href: "/", icon: <ItemIcon /> },
              {
                key: "soon",
                label: "Pronto",
                disabled: true,
                icon: <DisabledIcon />,
              },
            ],
          },
        ]}
        activeKey="home"
        displayName="Ana"
        onLogout={vi.fn()}
        navigate={vi.fn()}
        labels={LABELS}
      >
        <p>x</p>
      </AppShell>,
    );
    const activeIcon = screen.getByTestId("item-icon-active");
    const activeWrapper = activeIcon.parentElement;
    expect(activeWrapper).toHaveAttribute("aria-hidden", "true");
    expect(activeWrapper?.tagName).toBe("SPAN");

    const disabledIcon = screen.getByTestId("item-icon-disabled");
    const disabledWrapper = disabledIcon.parentElement;
    expect(disabledWrapper).toHaveAttribute("aria-hidden", "true");
    expect(disabledWrapper?.tagName).toBe("SPAN");
  });

  it("grupo con label string renderea heading <h2> con ese texto arriba de los items (ADR-0025)", () => {
    // Estructura agrupada: el shell acepta múltiples `SidebarGroup` y por cada
    // uno con `label !== null` renderea un `<h2>` visible (no-colapsable). El
    // heading vive dentro del `<nav>` → es sub-sección semántica.
    render(
      <AppShell
        title="Settings"
        sidebarGroups={[
          {
            label: "Identidad",
            items: [
              { key: "language", label: "Idioma", href: "/language" },
            ],
          },
          {
            label: "Estructura",
            items: [{ key: "zones", label: "Zonas", disabled: true }],
          },
        ]}
        activeKey="language"
        displayName="Ana"
        onLogout={vi.fn()}
        navigate={vi.fn()}
        labels={LABELS}
      >
        <p>x</p>
      </AppShell>,
    );
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      "Identidad",
      "Estructura",
    ]);
    // Sanity: los items de cada grupo siguen rendereándose normales.
    expect(
      screen.getByRole("link", { name: /idioma/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Zonas")).toBeInTheDocument();
  });

  it("grupo con label === null NO renderea heading (modo plano, compat nav-hub V1)", () => {
    render(
      <AppShell
        title="Hub"
        sidebarGroups={[{ label: null, items: ITEMS_BASE }]}
        activeKey="home"
        displayName="Ana"
        onLogout={vi.fn()}
        navigate={vi.fn()}
        labels={LABELS}
      >
        <p>x</p>
      </AppShell>,
    );
    // Sin headers en el modo plano — el contenido del label nunca aparece
    // como heading dentro del nav.
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    // Pero los items sí están — el grupo plano NO oculta nada.
    expect(screen.getByText("Inicio")).toBeInTheDocument();
    expect(screen.getByText("Mensajes")).toBeInTheDocument();
  });

  it("headers de grupo son fijos no-colapsables: <h2> sin role button ni aria-expanded (ADR-0025)", () => {
    // Render rule explícita de ADR-0025: el grupo NO es disclosure widget. El
    // header sólo etiqueta visualmente. Si esta afordancia se rompe (e.g., un
    // futuro refactor lo convierte en `<button aria-expanded>`), este test
    // falla y obliga a discutir el cambio en una nueva ADR.
    render(
      <AppShell
        title="Settings"
        sidebarGroups={[
          {
            label: "Identidad",
            items: [
              { key: "language", label: "Idioma", href: "/language" },
            ],
          },
        ]}
        activeKey="language"
        displayName="Ana"
        onLogout={vi.fn()}
        navigate={vi.fn()}
        labels={LABELS}
      >
        <p>x</p>
      </AppShell>,
    );
    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Identidad",
    });
    expect(heading.tagName).toBe("H2");
    expect(heading).not.toHaveAttribute("aria-expanded");
    expect(heading).not.toHaveAttribute("aria-controls");
    // Descarta colapsabilidad accidental: no debe existir botón con el
    // nombre del label dentro del nav.
    expect(
      screen.queryByRole("button", { name: "Identidad" }),
    ).not.toBeInTheDocument();
  });

  it("activeKey que no matchea ningún item → ningún item lleva aria-current (defensive)", () => {
    render(
      <AppShell
        title="Hub"
        sidebarGroups={[{ label: null, items: ITEMS_BASE }]}
        activeKey="ghost"
        displayName="Ana"
        onLogout={vi.fn()}
        navigate={vi.fn()}
        labels={LABELS}
      >
        <p>x</p>
      </AppShell>,
    );
    const links = screen.getAllByRole("link");
    for (const link of links) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });
});
