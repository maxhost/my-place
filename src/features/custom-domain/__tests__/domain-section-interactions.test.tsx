import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisterCustomDomain } from "../actions/register-custom-domain";
import {
  makeArchive,
  makeRecord,
  resetClipboard,
  setup,
  stubClipboard,
} from "./_domain-section-helpers";

// Tests Client del componente `<DomainSection>` — superficie interacciones
// avanzadas (S4 feature custom-domain V1, `docs/features/custom-domain/
// spec.md` §"UI states"). Tests de render + submit + validación viven en
// `domain-section.test.tsx` — splittear por LOC (CLAUDE.md §"Límites de
// tamaño": archivo ≤300). Helpers compartidos en `_domain-section-helpers`.
//
// jsdom + RTL + userEvent — seam-split canónico: el Client recibe
// `registerAction` / `archiveAction` por prop, los tests inyectan
// `vi.fn()` con el resultado deseado.
//
// Cobertura de este archivo:
//   1. Confirm dialog flow archive: Cancelar cierra sin invocar action.
//   2. Confirm dialog flow archive: Confirmar invoca con {placeSlug,
//      domainId} + `{slug}` reemplazado en el body.
//   3. Copy-to-clipboard: spy `navigator.clipboard.writeText` recibe valor
//      exacto + tooltip "Copiado!".
//   4. Auto-refresh fake timers cada 30s mientras pending.
//   5. Idempotencia: doble click ⇒ una sola invocación del action.

beforeEach(stubClipboard);
afterEach(resetClipboard);

describe("DomainSection — confirm dialog archive", () => {
  it("Cancelar cierra el dialog sin invocar `archiveAction`", async () => {
    const user = userEvent.setup();
    const archiveAction = makeArchive();
    setup({
      state: {
        status: "verified",
        record: makeRecord({ verifiedAt: new Date() }),
      },
      placeSlug: "mi-club",
      archiveAction,
    });
    await user.click(screen.getByRole("button", { name: "Remover" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(archiveAction).not.toHaveBeenCalled();
  });

  it("Confirmar invoca `archiveAction` 1 vez con {placeSlug, domainId} exactos + dialog renderea con {slug} reemplazado", async () => {
    const user = userEvent.setup();
    const archiveAction = makeArchive();
    setup({
      state: {
        status: "verified",
        record: makeRecord({
          id: "dom_42",
          verifiedAt: new Date(),
        }),
      },
      placeSlug: "mi-club",
      archiveAction,
    });
    await user.click(screen.getByRole("button", { name: "Remover" }));
    // {slug} reemplazado:
    expect(
      screen.getByText(
        "Tu place sigue disponible en mi-club.place.community. ¿Continuar?",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sí, remover" }));

    await waitFor(() => expect(archiveAction).toHaveBeenCalledTimes(1));
    expect(archiveAction).toHaveBeenCalledWith({
      placeSlug: "mi-club",
      domainId: "dom_42",
    });
  });
});

describe("DomainSection — copy-to-clipboard", () => {
  it("click en 'Copiar' invoca `navigator.clipboard.writeText` con el valor exacto y muestra tooltip 'Copiado!'", async () => {
    const user = userEvent.setup();
    // Stub explícito por test: `vi.fn` mantiene la identidad del spy entre
    // el define y la aserción posterior (el `beforeEach` global cubre el
    // resto de los tests donde no nos importa interceptar el writeText).
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    setup({
      state: {
        status: "pending",
        record: makeRecord(),
        dnsRecords: [{ type: "A", name: "@", value: "76.76.21.21" }],
      },
    });
    // 3 botones Copiar (uno por columna de la única fila).
    const copyButtons = screen.getAllByRole("button", { name: "Copiar" });
    expect(copyButtons).toHaveLength(3);
    // Click en el botón de la columna "Valor" (último).
    await user.click(copyButtons[2]);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith("76.76.21.21");
    expect(await screen.findByText("¡Copiado!")).toBeInTheDocument();
  });
});

describe("DomainSection — auto-refresh fake timers", () => {
  it("state=pending: invoca `onRefresh` cada 30s; al unmount deja de invocar", () => {
    vi.useFakeTimers();
    try {
      const onRefresh = vi.fn();
      const { unmount } = setup({
        state: {
          status: "pending",
          record: makeRecord(),
          dnsRecords: [],
        },
        onRefresh,
      });
      expect(onRefresh).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(onRefresh).toHaveBeenCalledTimes(1);
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(onRefresh).toHaveBeenCalledTimes(2);
      unmount();
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(onRefresh).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DomainSection — idempotencia ref", () => {
  it("doble click rápido en submit: action invocada 1 sola vez", async () => {
    const user = userEvent.setup();
    let resolve!: (r: Awaited<ReturnType<RegisterCustomDomain>>) => void;
    const registerAction = vi.fn<RegisterCustomDomain>(
      () => new Promise((r) => (resolve = r)),
    );
    setup({ state: { status: "none" }, registerAction });
    await user.type(screen.getByLabelText("Tu dominio"), "comunidad.test.com");
    const btn = screen.getByRole("button", { name: "Vincular dominio" });
    await user.click(btn);
    await user.click(btn);
    expect(registerAction).toHaveBeenCalledTimes(1);
    resolve({
      status: "ok",
      record: makeRecord(),
      dnsRecords: [],
    });
    await waitFor(() => expect(registerAction).toHaveBeenCalledTimes(1));
  });
});
