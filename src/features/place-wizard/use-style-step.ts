import { useState } from "react";
import { hexColorSchema, type Palette } from "@/shared/lib/palette-schema";
import { DEFAULT_PRESET_ID, PALETTE_PRESETS } from "./palettes";

// Sub-hook 3/6: Paso 2 (paleta modo preset/custom). Expone primitivos puros;
// el cruce LLM↔preset (envoltorio de choosePreset + setPaletteMode) vive en
// el orquestador. Ver mapa en `use-place-wizard.ts`.
//
// Diseño del estado de paleta (post-bug-fix 2026-05-19): `paletteMode` y
// `customPalette` son DOS estados ORTOGONALES — el modo decide qué paleta
// aplica el preview/submit, y `customPalette` PERSISTE aunque el modo esté
// en "preset" (es legítimo que el owner alterne modos sin perder ediciones).
// El bug histórico era el modo derivado (`customPalette ? "custom" : "preset"`),
// que obligaba a nullificar el custom para "estar en preset" → ediciones perdidas.
//
// El campo `description` se removió del wizard (ADR-0020, 2026-05-19) — la
// columna `place.description` permanece nullable en DB, diferida a /settings
// (mismo patrón que `opening_hours` por ADR-0007).

type PaletteMode = "preset" | "custom";

export function useStyleStep() {
  const [paletteMode, setPaletteModeState] = useState<PaletteMode>("preset");
  const [paletteId, setPaletteId] = useState(DEFAULT_PRESET_ID);
  // Persiste entre viajes de modo: en "preset" sigue vivo, en "custom" es la
  // fuente de verdad. `null` = el owner nunca entró a custom — el seed inicial
  // viene del preset actual al primer ingreso (`setPaletteMode("custom")`).
  const [customPalette, setCustomPalette] = useState<Palette | null>(null);

  const presetPalette =
    PALETTE_PRESETS.find((p) => p.id === paletteId)?.palette ??
    PALETTE_PRESETS[0].palette;
  // El modo decide qué paleta se aplica. En "custom" usa el custom (seed si null).
  const selectedPalette =
    paletteMode === "custom" ? (customPalette ?? presetPalette) : presetPalette;

  // Cambiar el preset NO toca `customPalette` — el custom es una entidad
  // separada del preset elegido. Si el modo está en "preset", el preview ve
  // el preset nuevo; si está en "custom", el preview sigue mostrando el custom
  // del owner (intencional: el custom es propiedad humana, no se sobrescribe).
  function choosePreset(id: string) {
    setPaletteId(id);
  }

  // Cambiar a "custom" por primera vez: seed inicial desde el preset actual.
  // Si ya hay custom (vuelve a custom tras pasar por preset, o el LLM acaba
  // de aplicar una propuesta en el mismo batch), se preserva. Functional
  // updater para leer el valor más reciente — el closure de `customPalette`
  // sería stale si el orquestador llama `setCustomPalette(p)` antes que
  // `setPaletteMode("custom")` en el mismo handler (caso LLM apply).
  function setPaletteMode(mode: PaletteMode) {
    setPaletteModeState(mode);
    if (mode === "custom") {
      setCustomPalette((prev) => prev ?? presetPalette);
    }
  }

  function setCustomHex(token: "accent" | "bg" | "ink", value: string) {
    const parsed = hexColorSchema.safeParse(value);
    if (!parsed.success) return;
    const base = customPalette ?? presetPalette;
    setCustomPalette({ ...base, [token]: parsed.data });
  }

  return {
    paletteId,
    customPalette,
    presetPalette,
    selectedPalette,
    paletteMode,
    setPaletteId,
    setCustomPalette,
    setPaletteMode,
    choosePreset,
    setCustomHex,
  };
}

export type { PaletteMode };
