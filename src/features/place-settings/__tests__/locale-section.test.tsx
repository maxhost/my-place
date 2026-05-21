import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PlaceLocale } from "@/features/place/public";
import type { UpdateDefaultLocale } from "../actions/update-default-locale";
import {
  LocaleSection,
  type LocaleSectionLabels,
} from "../ui/locale-section";

// Tests Client del form "Idioma del place" (S7 feature `settings`,
// `docs/features/settings/spec.md` §"Sección Idioma del place"). jsdom + RTL +
// userEvent — seam-split canónico: el Client recibe la action por prop
// (`updateAction`), los tests inyectan `vi.fn()` con el resultado deseado. El
// wiring vivo del Server Action contra Neon Auth + DB no se testea acá
// (`tests.md` §"Lo que NO probamos" / §"Server Action seam-split"); la
// correctitud del action es tipo/build + smoke prod.
//
// Cobertura del comportamiento descrito en el spec:
//   1. Render con `currentLocale="es"` → "Español" seleccionado; 6 opciones.
//   2. Pristine (sin cambios) → botón "Guardar" disabled.
//   3. Cambio del select → botón habilitado (dirty).
//   4. Submit → mock `updateAction({placeSlug, newLocale})` invocado 1 vez con
//      args correctos.
//   5. Action ok → success notice incluye el endonym del nuevo locale (resolve
//      del placeholder `{language}` del template `successBody`).
//   6. Action error → error notice + form sigue editable + estado dirty
//      persiste (puede reintentar).
//   7. Durante submit (action pendiente) → botón "Guardando…" + select
//      disabled.
//   8. Idempotencia: doble click no dispara dos actions (ref).

const LABELS: LocaleSectionLabels = {
  title: "Idioma del place",
  description: "Es el idioma en el que se mostrará tu lugar.",
  label: "Idioma",
  options: {
    es: "Español",
    en: "English",
    fr: "Français",
    pt: "Português",
    de: "Deutsch",
    ca: "Català",
  },
  save: "Guardar",
  saving: "Guardando…",
  successTitle: "Idioma actualizado.",
  successBody: "Tu lugar ahora aparece en {language}.",
  errorNotice: "No pudimos guardar el idioma. Probá de nuevo.",
};

function makeAction(over?: () => Promise<{ status: "ok" } | { status: "error" }>) {
  return vi.fn<UpdateDefaultLocale>(over ?? (async () => ({ status: "ok" })));
}

function setup(opts: {
  currentLocale?: PlaceLocale;
  placeSlug?: string;
  updateAction?: ReturnType<typeof makeAction>;
} = {}) {
  const updateAction = opts.updateAction ?? makeAction();
  const utils = render(
    <LocaleSection
      currentLocale={opts.currentLocale ?? "es"}
      placeSlug={opts.placeSlug ?? "mi-club"}
      updateAction={updateAction}
      labels={LABELS}
    />,
  );
  return { ...utils, updateAction };
}

function getSelect(): HTMLSelectElement {
  return screen.getByLabelText("Idioma") as HTMLSelectElement;
}

function getSubmit(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: /Guardar|Guardando…/,
  }) as HTMLButtonElement;
}

describe("LocaleSection — form Idioma del place (S7)", () => {
  it("render: currentLocale='es' → Español seleccionado y 6 opciones disponibles", () => {
    setup({ currentLocale: "es" });
    const select = getSelect();
    expect(select.value).toBe("es");
    expect(select.options).toHaveLength(6);
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "es",
      "en",
      "fr",
      "pt",
      "de",
      "ca",
    ]);
    expect(screen.getByRole("option", { name: "Español" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Deutsch" })).toBeInTheDocument();
  });

  it("pristine: 'Guardar' arranca disabled (nada que persistir)", () => {
    setup({ currentLocale: "es" });
    expect(getSubmit()).toBeDisabled();
  });

  it("cambio del select → estado dirty habilita 'Guardar'", async () => {
    const user = userEvent.setup();
    setup({ currentLocale: "es" });
    await user.selectOptions(getSelect(), "de");
    expect(getSelect().value).toBe("de");
    expect(getSubmit()).toBeEnabled();
  });

  it("submit ok: invoca updateAction con {placeSlug, newLocale} exactamente 1 vez y muestra success notice con el endonym del nuevo locale", async () => {
    const user = userEvent.setup();
    const updateAction = makeAction();
    setup({
      currentLocale: "es",
      placeSlug: "mi-club",
      updateAction,
    });
    await user.selectOptions(getSelect(), "de");
    await user.click(getSubmit());

    await waitFor(() =>
      expect(
        screen.getByText(/Tu lugar ahora aparece en Deutsch\./),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Idioma actualizado.")).toBeInTheDocument();
    expect(updateAction).toHaveBeenCalledTimes(1);
    expect(updateAction).toHaveBeenCalledWith({
      placeSlug: "mi-club",
      newLocale: "de",
    });
  });

  it("submit error: muestra error notice y el form sigue editable (dirty persiste, puede reintentar)", async () => {
    const user = userEvent.setup();
    const updateAction = makeAction(async () => ({ status: "error" }));
    setup({ currentLocale: "es", updateAction });
    await user.selectOptions(getSelect(), "ca");
    await user.click(getSubmit());

    await waitFor(() =>
      expect(
        screen.getByText(
          "No pudimos guardar el idioma. Probá de nuevo.",
        ),
      ).toBeInTheDocument(),
    );
    // Sigue editable: el select muestra el valor elegido y el botón se puede
    // re-clickear (no quedó submitting permanente).
    expect(getSelect().value).toBe("ca");
    expect(getSubmit()).toBeEnabled();
    expect(updateAction).toHaveBeenCalledTimes(1);
  });

  it("durante submit pendiente: botón muestra 'Guardando…' + select disabled", async () => {
    const user = userEvent.setup();
    let resolve!: (r: { status: "ok" } | { status: "error" }) => void;
    const updateAction = vi.fn<UpdateDefaultLocale>(
      () => new Promise((r) => (resolve = r)),
    );
    setup({ currentLocale: "es", updateAction });
    await user.selectOptions(getSelect(), "fr");
    await user.click(getSubmit());

    expect(
      screen.getByRole("button", { name: "Guardando…" }),
    ).toBeDisabled();
    expect(getSelect()).toBeDisabled();

    resolve({ status: "ok" });
    await waitFor(() =>
      expect(
        screen.getByText(/Tu lugar ahora aparece en Français\./),
      ).toBeInTheDocument(),
    );
  });

  it("idempotencia: doble click no dispara dos actions", async () => {
    const user = userEvent.setup();
    let resolve!: (r: { status: "ok" } | { status: "error" }) => void;
    const updateAction = vi.fn<UpdateDefaultLocale>(
      () => new Promise((r) => (resolve = r)),
    );
    setup({ currentLocale: "es", updateAction });
    await user.selectOptions(getSelect(), "pt");
    const btn = getSubmit();
    await user.click(btn);
    await user.click(btn);
    expect(updateAction).toHaveBeenCalledTimes(1);

    resolve({ status: "ok" });
    await waitFor(() =>
      expect(
        screen.getByText(/Tu lugar ahora aparece en Português\./),
      ).toBeInTheDocument(),
    );
  });

  it("tras success vuelve a pristine: 'Guardar' disabled (el nuevo locale ya está persistido)", async () => {
    const user = userEvent.setup();
    setup({ currentLocale: "es" });
    await user.selectOptions(getSelect(), "en");
    await user.click(getSubmit());

    await waitFor(() => expect(screen.getByText("Idioma actualizado.")).toBeInTheDocument());
    // Ya no hay diff entre el valor del select y el último guardado → disabled.
    expect(getSubmit()).toBeDisabled();
  });
});
