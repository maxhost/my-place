// Interfaz pública de la feature `place-creation` (paradigma vertical-slice:
// las demás features / rutas importan SÓLO desde acá, nunca de internos).
// Dominio + saga + wizard de creación de place (ADR-0005). El slice `access`
// (vía "Acceso", ADR-0008/0009) consume el wizard reusado en modo authed
// desde acá — arista feature→feature unidireccional (ADR-0014).

export { createPlaceAction } from "./actions";
export type { PlaceFirstCredentials } from "./actions";
export type { CreatePlaceResult } from "./create-place";
export type { CreatePlaceInput } from "./domain/schema";

// La asistencia LLM propose-only se movió al slice `style-assist` (ADR-0015);
// el wizard la consume vía `@/features/style-assist/public` (lo cablea S10b).

// UI del wizard (S8) — la ruta `(marketing)/[locale]/crear` la monta;
// `access` la reusa en modo authed vía esta interfaz.
export { PlaceWizard } from "./ui/place-wizard";
export type {
  WizardLabels,
  WizardSubmit,
  WizardSuggest,
} from "./ui/place-wizard";
export { PALETTE_PRESET_IDS } from "./ui/palettes";
