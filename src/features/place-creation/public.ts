// Interfaz pública de la feature `place-creation` (paradigma vertical-slice:
// las demás features / rutas importan SÓLO desde acá, nunca de internos).
// Dominio + saga + wizard de creación de place (ADR-0005). El slice `access`
// (vía "Acceso", ADR-0008/0009) consume el wizard reusado en modo authed
// desde acá — arista feature→feature unidireccional (ADR-0014).

export { createPlaceAction } from "./actions";
export type { PlaceFirstCredentials } from "./actions";
export type { CreatePlaceResult } from "./create-place";
export type { CreatePlaceInput } from "./domain/schema";

// Servicio LLM propose-only (S10a, ADR-0005 §5 / ADR-0007). El Server Action
// vivo (Vercel AI Gateway) se inyecta como prop en la ruta; S10b lo consume
// como `SuggestStyle` (seam-split, igual que el submit del wizard).
export { suggestStyleAction } from "./suggest-style-action";
export type { StyleSuggestion } from "./domain/style-suggestion";
export type { StyleSuggestionResult } from "./suggest-style";
export type SuggestStyle = typeof import("./suggest-style-action").suggestStyleAction;

// UI del wizard (S8) — la ruta `(marketing)/[locale]/crear` la monta;
// `access` la reusa en modo authed vía esta interfaz.
export { PlaceWizard } from "./ui/place-wizard";
export type { WizardLabels, WizardSubmit } from "./ui/place-wizard";
export { PALETTE_PRESET_IDS } from "./ui/palettes";
