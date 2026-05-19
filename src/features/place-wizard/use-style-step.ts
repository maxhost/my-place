import { useState } from "react";
import { hexColorSchema, type Palette } from "@/shared/lib/palette-schema";
import { DEFAULT_PRESET_ID, PALETTE_PRESETS } from "./palettes";

// use-style-step.ts — Sub-hook 4/6 de `use-place-wizard`.
// Paso 2 (datos): descripción libre + paleta (modo "preset" o "custom").
// Autónomo internamente (no consume otros sub-hooks). Expone setters que la
// asistencia LLM (`use-style-assist`) consume para aplicar su propuesta —
// el cruce LLM↔preset (resetear "Aplicado" cuando el owner elige preset a
// mano) se inyecta via callback opcional `onPresetChosen` (lo wirea el
// orquestador en `use-place-wizard.ts`).

type PaletteMode = "preset" | "custom";

export function useStyleStep(opts: { onPresetChosen?: () => void } = {}) {
  const [description, setDescription] = useState("");
  const [paletteId, setPaletteId] = useState(DEFAULT_PRESET_ID);
  // `null` ⇒ manda el preset. El LLM apply lo llena; al elegir preset se
  // limpia (preset gana — `producto.md` §30 customización activa).
  const [customPalette, setCustomPalette] = useState<Palette | null>(null);

  const descTooLong = description.trim().length > 500;
  const presetPalette =
    PALETTE_PRESETS.find((p) => p.id === paletteId)?.palette ??
    PALETTE_PRESETS[0].palette;
  const selectedPalette = customPalette ?? presetPalette;
  // Modo DERIVADO: customPalette no-null ⇒ "custom" (sin estado redundante).
  const paletteMode: PaletteMode = customPalette ? "custom" : "preset";

  function choosePreset(id: string) {
    setPaletteId(id);
    setCustomPalette(null);
    opts.onPresetChosen?.();
  }

  function setPaletteMode(mode: PaletteMode) {
    if (mode === "custom" && !customPalette) setCustomPalette(presetPalette);
    else if (mode === "preset") choosePreset(paletteId);
  }

  function setCustomHex(token: "accent" | "bg" | "ink", value: string) {
    const parsed = hexColorSchema.safeParse(value);
    if (!parsed.success) return;
    const base = customPalette ?? presetPalette;
    setCustomPalette({ ...base, [token]: parsed.data });
  }

  return {
    description,
    descTooLong,
    paletteId,
    customPalette,
    presetPalette,
    selectedPalette,
    paletteMode,
    setDescription,
    setPaletteId,
    setCustomPalette,
    choosePreset,
    setPaletteMode,
    setCustomHex,
  };
}
