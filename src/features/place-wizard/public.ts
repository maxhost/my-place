// Interfaz pública de la feature `place-wizard` (paradigma vertical-slice:
// las demás features / rutas importan SÓLO desde acá, nunca de internos).
// UI del wizard place-first (ADR-0005, S8): shell + pasos + máquina de estado
// + isla de asistencia propose-only. Extraído de `place-creation` por
// ADR-0016. Seam-split: los Server Actions vivos (`createPlaceAction` /
// `suggestStyleAction`) se inyectan como props en las rutas — el wizard no
// los importa. Consume de `place-creation` (tipos + `slugSchema`) y de
// `style-assist` (tipo `StyleSuggestion`) SOLO vía sus `public.ts`: aristas
// feature→feature unidireccionales y acíclicas. La ruta
// `(marketing)/[locale]/crear` lo monta; `access` lo reusa en modo authed.

export { PlaceWizard } from "./place-wizard";
export type {
  WizardLabels,
  WizardSubmit,
  WizardSuggest,
  PlaceFirstCredentials,
} from "./place-wizard";
export { PALETTE_PRESET_IDS } from "./palettes";
