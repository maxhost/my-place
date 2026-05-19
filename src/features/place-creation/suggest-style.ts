import {
  type StyleSuggestion,
  parseStyleSuggestion,
} from "./domain/style-suggestion";
import type { StyleSuggester } from "./ports";

// Saga del servicio LLM (S10a, ADR-0005 §5 / ADR-0007). Orquestación PURA:
// input → puerto LLM (inyectado) → dominio (valida + guardrail). El modo de
// fallo es SIEMPRE `unavailable` (degradación elegante, ADR-0005 §5): la
// asistencia es OPCIONAL — su caída (red, timeout, cuota, salida malformada)
// jamás rompe el wizard ni lanza al caller. Nada se persiste (propose-only).

export type StyleSuggestionResult =
  | ({ status: "suggested" } & StyleSuggestion)
  | { status: "unavailable" };

// Acota el prompt: el owner describe "para quién", no escribe un ensayo.
const MAX_INPUT = 2000;

export async function suggestStyle(
  description: unknown,
  ports: { suggest: StyleSuggester },
): Promise<StyleSuggestionResult> {
  // Sin descripción no hay nada que sugerir: no se gasta una llamada al modelo.
  const text = typeof description === "string" ? description.trim() : "";
  if (text.length === 0) return { status: "unavailable" };

  try {
    const raw = await ports.suggest(text.slice(0, MAX_INPUT));
    return { status: "suggested", ...parseStyleSuggestion(raw) };
  } catch {
    // El modelo lanzó o devolvió malformado → degradación elegante. NUNCA
    // propaga: la asistencia LLM es opcional (ADR-0005 §5).
    return { status: "unavailable" };
  }
}
