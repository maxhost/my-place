// Interfaz pública de la feature `style-assist` (paradigma vertical-slice:
// las demás features / rutas importan SÓLO desde acá, nunca de internos).
// Asistencia LLM propose-only del onboarding (ADR-0005 §5 / ADR-0007),
// extraída de `place-creation` por ADR-0015. El wizard de `place-creation`
// la consume vía esta interfaz (arista feature→feature unidireccional, la
// cablea S10b — mismo patrón que `access`→`place-creation`, ADR-0014).
// `style-assist` no importa de ninguna feature (solo `shared/`): acíclico.

export { suggestStyleAction } from "./suggest-style-action";
export type { StyleSuggestion } from "./domain/style-suggestion";
export type { StyleSuggestionResult } from "./suggest-style";
export type SuggestStyle =
  typeof import("./suggest-style-action").suggestStyleAction;
