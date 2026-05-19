// Interfaz pública de la feature `style-assist` (paradigma vertical-slice:
// las demás features / rutas importan SÓLO desde acá, nunca de internos).
// Asistencia LLM propose-only del onboarding (ADR-0005 §5 / ADR-0007),
// extraída de `place-creation` por ADR-0015.
//
// ADR-0020 (2026-05-19): la asistencia LLM está PAUSADA en el MVP. La UI
// glue (hook `use-style-assist`, componente `style-assist-island`, contrato
// `StyleAssistLabels`) se eliminó del slice. La saga + Server Action +
// dominio quedan **dormidos y testeados** (`__tests__/suggest-style.test.ts`
// sigue verde) — listos para reactivar cuando ADR-0020 sea superseded.
//
// Sin consumer activo de producción: `grep -rn "@/features/style-assist"`
// debería matchear sólo este archivo (re-exports internos). Si esa búsqueda
// devuelve un consumer activo, revisar — puede indicar reactivación o leak.

export { suggestStyleAction } from "./suggest-style-action";
export type { StyleSuggestion } from "./domain/style-suggestion";
export type { StyleSuggestionResult } from "./suggest-style";
export type SuggestStyle =
  typeof import("./suggest-style-action").suggestStyleAction;
