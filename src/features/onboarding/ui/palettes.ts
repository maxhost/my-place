import { PAPEL_PALETTE } from "../domain/defaults";
import type { Palette } from "../domain/schema";

// Paleta ACOTADA del wizard (ADR-0007: el owner elige entre opciones, no un
// picker libre — cozytech: sin abrumar). Default = Papel (marca). Cada preset
// es AA-limpio por diseño: NO se ofrecen defaults rotos; el guardrail de
// contraste (PlacePreview) queda como defensa en profundidad para S10 (paleta
// propuesta por LLM) y un eventual picker libre futuro. La sugerencia LLM
// (S10) es propose-only y también pasa por el guardrail.

export interface PalettePreset {
  /** id estable → clave de i18n (`labels.paletteNames[id]`). */
  id: string;
  palette: Palette;
}

export const PALETTE_PRESETS: readonly PalettePreset[] = [
  { id: "papel", palette: { ...PAPEL_PALETTE } },
  { id: "bosque", palette: { accent: "#2f6d4f", bg: "#f4f6f1", ink: "#1b211c" } },
  { id: "tinta", palette: { accent: "#3a4a8c", bg: "#f3f4f8", ink: "#191b24" } },
  { id: "arcilla", palette: { accent: "#a8533a", bg: "#f7f1ec", ink: "#231b18" } },
] as const;

export const DEFAULT_PRESET_ID = "papel";

/** ids estables de los presets — la ruta los mapea a nombres traducidos. */
export const PALETTE_PRESET_IDS: readonly string[] = PALETTE_PRESETS.map(
  (p) => p.id,
);
