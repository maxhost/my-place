// Interfaz pública de la feature `style-assist` (paradigma vertical-slice:
// las demás features / rutas importan SÓLO desde acá, nunca de internos).
// Asistencia LLM propose-only del onboarding (ADR-0005 §5 / ADR-0007),
// extraída de `place-creation` por ADR-0015. Por ADR-0019 el slice también
// es dueño de su UI glue: el hook `useStyleAssist` (máquina propose-only),
// el componente `StyleAssistIsland` (presentacional) y el contrato narrow
// de labels (`StyleAssistLabels`). El wizard de `place-wizard` los consume
// vía esta interfaz (`WizardLabels extends StyleAssistLabels`, el wrapper
// del Server Action se inyecta como prop). `style-assist` no importa de
// ninguna feature (solo `shared/` + react): acíclico.

export { suggestStyleAction } from "./suggest-style-action";
export type { StyleSuggestion } from "./domain/style-suggestion";
export type { StyleSuggestionResult } from "./suggest-style";
export type SuggestStyle =
  typeof import("./suggest-style-action").suggestStyleAction;

// UI glue (ADR-0019).
export { useStyleAssist } from "./use-style-assist";
export { StyleAssistIsland } from "./style-assist-island";
export type { StyleAssistLabels } from "./labels";
