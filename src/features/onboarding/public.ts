// Interfaz pública de la feature `onboarding` (paradigma vertical-slice: las
// demás features / rutas importan SÓLO desde acá, nunca de internos). S8
// (wizard place-first) y S9 (vía "Acceso", modo authed) consumen esto.

export { createPlaceAction } from "./actions";
export type { PlaceFirstCredentials } from "./actions";
export type { CreatePlaceResult } from "./create-place";
export type { CreatePlaceInput } from "./domain/schema";

// UI del wizard (S8) — la ruta `(marketing)/[locale]/crear` la monta.
export { PlaceWizard } from "./ui/place-wizard";
export type { WizardLabels, WizardSubmit } from "./ui/place-wizard";
export { PALETTE_PRESET_IDS } from "./ui/palettes";

// Vía "Acceso" (S9) — la ruta `(marketing)/[locale]/login` la monta.
export { AccessFlow } from "./ui/access-flow";
export type { AccessLabels, AccessSubmit } from "./ui/access-labels";
export { loginAction, signUpAccountAction } from "./auth-actions";
