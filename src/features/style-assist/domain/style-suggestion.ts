import { z } from "zod";
import {
  type ContrastAdjustment,
  applyContrastGuardrail,
} from "@/shared/lib/contrast";
import { type Palette, paletteSchema } from "@/shared/lib/palette-schema";

// Salida del LLM del onboarding (ADR-0005 §5 / ADR-0007: paleta + borrador de
// descripción, SIN horario). PURO: sin red. El servicio re-valida acá la
// salida CRUDA del modelo (defensa en profundidad — NUNCA se confía en el
// LLM: `paletteSchema` normaliza/rechaza hex) y aplica el guardrail de
// contraste a la paleta propuesta (S5a), de modo que lo que se le ofrece al
// owner ya es accesible (ADR-0005 §8). Nada se persiste: propose-only; el
// owner confirma cada parte en S10b (ADR-0005 §6).

// El borrador alinea su tope con `createPlaceInput.description` (≤500): si el
// owner lo aplica tal cual, ya entra en el dominio de creación sin recortes.
export const styleSuggestionSchema = z.object({
  palette: paletteSchema,
  descriptionDraft: z
    .string()
    .transform((s) => s.trim())
    .pipe(
      z
        .string()
        .min(1, "El borrador de descripción no puede estar vacío")
        .max(500, "El borrador no puede exceder 500 caracteres"),
    ),
});

export class StyleSuggestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StyleSuggestionError";
  }
}

export interface StyleSuggestion {
  /** Paleta propuesta YA pasada por el guardrail (accesible, ADR-0005 §8). */
  palette: Palette;
  /** Acento que cumple WCAG (derivado de render, NO se persiste — ADR-0005 §7). */
  accentStrong: string;
  /** Avisos del guardrail sobre la paleta propuesta (se muestran en S10b). */
  adjustments: ContrastAdjustment[];
  descriptionDraft: string;
}

/**
 * Valida la salida CRUDA del modelo y aplica el guardrail. Lanza
 * `StyleSuggestionError` (nunca filtra el `ZodError` crudo) si es malformada;
 * la saga lo traduce a `unavailable` (degradación elegante, ADR-0005 §5).
 * NUNCA persiste.
 */
export function parseStyleSuggestion(raw: unknown): StyleSuggestion {
  const parsed = styleSuggestionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new StyleSuggestionError("El modelo devolvió una salida inválida");
  }
  const guard = applyContrastGuardrail(parsed.data.palette);
  return {
    palette: guard.palette,
    accentStrong: guard.accentStrong,
    adjustments: guard.adjustments,
    descriptionDraft: parsed.data.descriptionDraft,
  };
}
