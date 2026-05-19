import { useState } from "react";
import { hexColorSchema, type Palette } from "@/shared/lib/palette-schema";
import { DEFAULT_PRESET_ID, PALETTE_PRESETS } from "./palettes";

// Sub-hook 3/6: Paso 2 (descripción + paleta modo preset/custom). Expone
// primitivos puros; el cruce LLM↔preset (envoltorio de choosePreset +
// setPaletteMode) vive en el orquestador. Ver mapa en `use-place-wizard.ts`.

type PaletteMode = "preset" | "custom";

export function useStyleStep() {
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
  }

  /** Caso borde del segmented control: si el owner pasa a "custom" sin
   *  haber editado nada, copia el preset actual para que el modo persista
   *  (el derivado `paletteMode` necesita `customPalette` no-null). */
  function activateCustomFromPreset() {
    if (!customPalette) setCustomPalette(presetPalette);
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
    activateCustomFromPreset,
    setCustomHex,
  };
}

export type { PaletteMode };
