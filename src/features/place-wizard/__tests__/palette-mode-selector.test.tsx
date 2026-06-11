import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PALETTE_PRESETS, PALETTE_PRESET_IDS } from "../palettes";
import { PaletteModeSelector } from "../palette-mode-selector";
import type { WizardLabels } from "../wizard-labels";

// Tests del selector de modo de paleta (predefinidas vs personalizado).
// Componente presentacional puro: estado del modo y la paleta custom los
// gobierna el hook (`use-place-wizard.ts`). Acá testeamos contrato + UX
// calmo (cozytech `producto.md` §23-29): el aviso de hex inválido NO
// bloquea, no parpadea, no grita.

const PAPEL = PALETTE_PRESETS[0].palette;

// Subset relevante de `WizardLabels`. El resto se rellena con placeholders
// porque el componente no lo consume — el tipo lo exige.
const LABELS: WizardLabels = {
  title: "x", progress: "x", stepTitles: ["x"], next: "x", back: "x",
  create: "x", creating: "x", nameLabel: "x", namePlaceholder: "x",
  slugLabel: "x", slugHint: "x", slugReserved: "x", slugFormat: "x",
  slugAvailableHint: "x", nameRequired: "x", previewLabel: "x",
  previewEmptyName: "x",
  guardrailNotice: "Ajustamos un color para que se lea bien",
  paletteLabel: "Colores",
  paletteNames: { papel: "Papel", bosque: "Bosque", tinta: "Tinta", arcilla: "Arcilla" },
  emailLabel: "x", emailPlaceholder: "x", emailInvalid: "x",
  passwordLabel: "x", passwordPlaceholder: "x", passwordHint: "x",
  passwordTooShort: "x", displayNameLabel: "x", displayNamePlaceholder: "x",
  displayNameRequired: "x", terms: "x", termsLinkLabel: "x",
  privacyLinkLabel: "x", termsRequired: "x", successTitle: "x",
  successBody: "x", successOpen: "x", slugTakenNotice: "x",
  invalidNotice: "x", errorNotice: "x", rateLimitedNotice: "x",
  accountFailedNotice: "x",
  paletteModeLabel: "¿Cómo elegís los colores?",
  paletteModePreset: "Predefinidas",
  paletteModeCustom: "Personalizado",
  paletteCustomTitle: "Tus colores",
  paletteCustomAccentLabel: "Color principal",
  paletteCustomBgLabel: "Fondo",
  paletteCustomInkLabel: "Texto",
  paletteCustomHexInvalid: "Hex inválido (#rrggbb).",
  paletteCustomPickerSuffix: "(selector de color)",
  // S2b.2: keys del selector de idioma del Paso 1 (ADR-0022 + ADR-0024). No los
  // consume este componente (Paso 2); presentes sólo para satisfacer el tipo.
  defaultLocaleLabel: "x",
  defaultLocaleOptions: { es: "x", en: "x", fr: "x", pt: "x", de: "x", ca: "x" },
};

function setup(
  override: Partial<Parameters<typeof PaletteModeSelector>[0]> = {},
) {
  const onModeChange = vi.fn();
  const onPresetChange = vi.fn();
  const onCustomHexChange = vi.fn();
  const utils = render(
    <PaletteModeSelector
      labels={LABELS}
      mode="preset"
      presetIds={PALETTE_PRESET_IDS}
      selectedPresetId="papel"
      customPalette={null}
      onModeChange={onModeChange}
      onPresetChange={onPresetChange}
      onCustomHexChange={onCustomHexChange}
      {...override}
    />,
  );
  return { ...utils, onModeChange, onPresetChange, onCustomHexChange };
}

describe("PaletteModeSelector — modo preset (default)", () => {
  it("muestra el segmented control con 'Predefinidas' seleccionado y los 4 presets", () => {
    setup();
    const preset = screen.getByRole("radio", { name: "Predefinidas" });
    const custom = screen.getByRole("radio", { name: "Personalizado" });
    expect(preset).toBeChecked();
    expect(custom).not.toBeChecked();
    // Los 4 presets están como radios visibles.
    for (const name of ["Papel", "Bosque", "Tinta", "Arcilla"]) {
      expect(screen.getByRole("radio", { name })).toBeInTheDocument();
    }
    // No hay inputs hex en modo preset.
    expect(screen.queryByLabelText("Color principal")).not.toBeInTheDocument();
  });

  it("click en 'Personalizado' llama onModeChange('custom')", async () => {
    const user = userEvent.setup();
    const { onModeChange } = setup();
    await user.click(screen.getByRole("radio", { name: "Personalizado" }));
    expect(onModeChange).toHaveBeenCalledWith("custom");
  });
});

describe("PaletteModeSelector — modo personalizado", () => {
  it("renderiza 3 inputs hex prefillados desde customPalette", () => {
    setup({ mode: "custom", customPalette: PAPEL });
    const accent = screen.getByLabelText<HTMLInputElement>("Color principal");
    const bg = screen.getByLabelText<HTMLInputElement>("Fondo");
    const ink = screen.getByLabelText<HTMLInputElement>("Texto");
    expect(accent.value.toLowerCase()).toBe(PAPEL.accent);
    expect(bg.value.toLowerCase()).toBe(PAPEL.bg);
    expect(ink.value.toLowerCase()).toBe(PAPEL.ink);
    // 'Personalizado' marcado.
    expect(
      screen.getByRole("radio", { name: "Personalizado" }),
    ).toBeChecked();
  });

  it("hex válido en accent llama onCustomHexChange normalizado", async () => {
    const user = userEvent.setup();
    const { onCustomHexChange } = setup({
      mode: "custom",
      customPalette: PAPEL,
    });
    const accent = screen.getByLabelText<HTMLInputElement>("Color principal");
    await user.clear(accent);
    await user.type(accent, "#aabbcc");
    // El último call lleva el hex completo (chars previos generan intermedios).
    const last = onCustomHexChange.mock.calls.at(-1);
    expect(last).toEqual(["accent", "#aabbcc"]);
  });

  it("hex inválido muestra aviso calmo sin parpadeo (cozytech)", async () => {
    const user = userEvent.setup();
    setup({ mode: "custom", customPalette: PAPEL });
    const accent = screen.getByLabelText<HTMLInputElement>("Color principal");
    await user.clear(accent);
    await user.type(accent, "#zz");
    expect(
      screen.getByText("Hex inválido (#rrggbb)."),
    ).toBeInTheDocument();
    // Los otros canales no muestran el aviso.
    expect(screen.getAllByText("Hex inválido (#rrggbb).")).toHaveLength(1);
  });

  it("el picker nativo de color tiene aria-label con el sufijo", () => {
    setup({ mode: "custom", customPalette: PAPEL });
    // 3 pickers nativos, uno por canal, con aria-label "<canal> (selector de color)".
    expect(
      screen.getByLabelText("Color principal (selector de color)"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Fondo (selector de color)"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Texto (selector de color)"),
    ).toBeInTheDocument();
  });

  it("click en 'Predefinidas' llama onModeChange('preset')", async () => {
    const user = userEvent.setup();
    const { onModeChange } = setup({
      mode: "custom",
      customPalette: PAPEL,
    });
    await user.click(screen.getByRole("radio", { name: "Predefinidas" }));
    expect(onModeChange).toHaveBeenCalledWith("preset");
  });
});
