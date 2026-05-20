import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountMenu } from "../ui/account-menu";

// Tests del menú de cuenta (S3 del Hub V1). Dropdown anclado al avatar de la
// topbar. V1 sólo tiene "Cerrar sesión"; futuro: "Mi perfil", "Notificaciones",
// "Cambiar idioma".
//
// Comportamiento: click avatar → toggle open; click "Cerrar sesión" → invoca
// `onLogout` (Server Action inyectada — patrón seam-split del repo) y muestra
// pending; click fuera → cierra. La acción retorna `{redirectTo}`; el
// componente navega vía la prop `navigate` (default `window.location.assign`).
// En tests se inyecta `navigate={vi.fn()}` para verificar la URL — jsdom
// no permite spyOn estable sobre `window.location.assign`.
//
// `computeInitials` se testea aparte en `src/shared/lib/__tests__/initials.test.ts`
// — se movió a shared en S4 porque el slice `inbox` también lo consume (slices
// no se importan entre sí; sólo desde `shared/`).

describe("AccountMenu — dropdown de cuenta del hub", () => {
  it("por default el menú está cerrado: sólo el botón avatar visible", () => {
    render(
      <AccountMenu
        triggerLabel="Mi cuenta"
        logoutLabel="Cerrar sesión"
        logoutPendingLabel="Cerrando sesión…"
        displayName="Ana"
        onLogout={vi.fn()}
        navigate={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Mi cuenta" })).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /cerrar sesión/i }),
    ).not.toBeInTheDocument();
  });

  it("click avatar abre el menú con el item 'Cerrar sesión'", async () => {
    const user = userEvent.setup();
    render(
      <AccountMenu
        triggerLabel="Mi cuenta"
        logoutLabel="Cerrar sesión"
        logoutPendingLabel="Cerrando sesión…"
        displayName="Ana"
        onLogout={vi.fn()}
        navigate={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Mi cuenta" }));
    expect(
      screen.getByRole("menuitem", { name: /cerrar sesión/i }),
    ).toBeInTheDocument();
  });

  it("click 'Cerrar sesión' invoca onLogout y navega al redirectTo", async () => {
    const user = userEvent.setup();
    const onLogout = vi
      .fn()
      .mockResolvedValue({ redirectTo: "https://place.community/es/" });
    const navigate = vi.fn();
    render(
      <AccountMenu
        triggerLabel="Mi cuenta"
        logoutLabel="Cerrar sesión"
        logoutPendingLabel="Cerrando sesión…"
        displayName="Ana"
        onLogout={onLogout}
        navigate={navigate}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Mi cuenta" }));
    await user.click(screen.getByRole("menuitem", { name: /cerrar sesión/i }));
    expect(onLogout).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("https://place.community/es/"),
    );
  });

  it("muestra 'Cerrando sesión…' mientras la acción está en vuelo", async () => {
    const user = userEvent.setup();
    let resolveLogout: (value: { redirectTo: string }) => void = () => {};
    const onLogout = vi.fn(
      () =>
        new Promise<{ redirectTo: string }>((resolve) => {
          resolveLogout = resolve;
        }),
    );
    render(
      <AccountMenu
        triggerLabel="Mi cuenta"
        logoutLabel="Cerrar sesión"
        logoutPendingLabel="Cerrando sesión…"
        displayName="Ana"
        onLogout={onLogout}
        navigate={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Mi cuenta" }));
    await user.click(screen.getByRole("menuitem", { name: /cerrar sesión/i }));
    expect(
      await screen.findByRole("menuitem", { name: /cerrando sesión/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /cerrando sesión/i }),
    ).toHaveAttribute("aria-disabled", "true");
    // Liberamos la promesa para no dejar timers colgados.
    resolveLogout({ redirectTo: "https://place.community/es/" });
  });

  it("click fuera del menú lo cierra", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button>otro</button>
        <AccountMenu
          triggerLabel="Mi cuenta"
          logoutLabel="Cerrar sesión"
          logoutPendingLabel="Cerrando sesión…"
          displayName="Ana"
          onLogout={vi.fn()}
          navigate={vi.fn()}
        />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Mi cuenta" }));
    expect(
      screen.getByRole("menuitem", { name: /cerrar sesión/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "otro" }));
    expect(
      screen.queryByRole("menuitem", { name: /cerrar sesión/i }),
    ).not.toBeInTheDocument();
  });
});
