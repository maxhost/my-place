// Interfaz pública de la feature `place-wizard` (paradigma vertical-slice:
// las demás features / rutas importan SÓLO desde acá, nunca de internos).
// UI del wizard place-first (ADR-0005, S8): shell + pasos + máquina de estado.
// Extraído de `place-creation` por ADR-0016. Seam-split: el Server Action
// vivo (`createPlaceAction`) se inyecta como prop en las rutas — el wizard no
// lo importa. Consume de `place-creation` (tipos + `slugSchema`) SOLO vía su
// `public.ts`: aristas feature→feature unidireccionales y acíclicas. La ruta
// `(marketing)/[locale]/crear` lo monta; `access` lo reusa en modo authed.
//
// ADR-0020 (2026-05-19): la asistencia LLM propose-only del onboarding está
// pausada en el MVP. El wizard ya no importa de `style-assist` ni expone
// `WizardSuggest` — el slice `style-assist` queda dormido (saga + Server
// Action + dominio testeados, sin consumer activo).

export { PlaceWizard } from "./place-wizard";
export type {
  WizardLabels,
  WizardSubmit,
  WizardSignUp,
  PlaceFirstCredentials,
} from "./place-wizard";
export { PALETTE_PRESET_IDS } from "./palettes";
