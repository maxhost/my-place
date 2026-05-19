import type {
  CreatePlaceInput,
  CreatePlaceResult,
} from "@/features/place-creation/public";
import type {
  StyleAssistLabels,
  SuggestStyle,
} from "@/features/style-assist/public";

// Tipos del wizard (S8b). Separados del componente para no exceder el límite
// de archivo (CLAUDE.md ≤300) y para que la ruta + los pasos compartan el
// contrato de textos sin acoplarse al cliente. `WizardLabels` compone
// `StyleAssistLabels` (los 12 keys i18n de la isla LLM viven en su slice
// dueño, ADR-0019); `guardrailNotice` viene de allí y lo shareea con el
// `place-preview` del wizard (ambos consumers del mismo key — sin duplicar).

export interface PlaceFirstCredentials {
  email: string;
  password: string;
  displayName: string;
}

// Creación de place SIEMPRE en modo authed: la sesión ya está establecida
// (place-first la establece antes vía `WizardSignUp` en una request previa;
// authed/"Acceso" ya la tiene). `createPlaceAction` adquiere el JWT de la
// sesión vigente (`auth.token()`), por eso NO recibe credenciales: el token
// de `signUp` es de sesión opaco, no un JWT (evidencia preview 2026-05-19).
export type WizardSubmit = (
  input: CreatePlaceInput,
) => Promise<CreatePlaceResult>;

// Place-first: crear la CUENTA es una request separada y PREVIA a crear el
// place — Neon Auth `signUp` setea la cookie de sesión en su respuesta pero
// NO es re-legible en la misma invocación; recién la request siguiente
// (el `WizardSubmit` authed) la tiene y puede pedir el JWT. `signUp` NO crea
// `app_user` ("cuenta sin place" es legítimo, ADR-0008 §4): lo asegura la
// TX 1 del create authed (idempotente). `status === "ok"` = cuenta lista
// (cookie establecida); cualquier otro = no se pudo (aviso calmo, sin
// afirmar el detalle del SDK — cozytech). Espeja `signUpAccountAction`.
export type WizardSignUp = (
  credentials: PlaceFirstCredentials,
) => Promise<{ status: string }>;

// Asistencia LLM propose-only (ADR-0005 §5/§6 / ADR-0007). Seam-split: el
// Server Action vivo se inyecta como prop en la ruta. Alias del tipo del
// Server Action de `style-assist` (ADR-0019: el slice LLM es dueño del
// contrato; aquí re-exportamos como alias para preservar la API del wizard).
export type WizardSuggest = SuggestStyle;

// `WizardLabels` extiende `StyleAssistLabels` (ADR-0019): los 12 keys i18n
// que la isla LLM consume viven en `style-assist`. El wizard sigue siendo
// dueño del bag completo de labels + i18n; el subconjunto LLM viene tipado
// desde el slice dueño. Liskov: cualquier `WizardLabels` es estructuralmente
// válido como `StyleAssistLabels` (TS estructural, sin runtime change).
export interface WizardLabels extends StyleAssistLabels {
  title: string;
  /** Plantilla con `{n}` y `{total}`, ej. "Paso {n} de {total}". */
  progress: string;
  /** Títulos de los 3 pasos. */
  stepTitles: string[];
  next: string;
  back: string;
  create: string;
  creating: string;
  nameLabel: string;
  namePlaceholder: string;
  slugLabel: string;
  /** Plantilla con `{slug}` y `{domain}`. */
  slugHint: string;
  slugReserved: string;
  slugFormat: string;
  slugAvailableHint: string;
  nameRequired: string;
  previewLabel: string;
  previewEmptyName: string;
  paletteLabel: string;
  /** id de preset → nombre traducido. */
  paletteNames: Record<string, string>;
  emailLabel: string;
  emailPlaceholder: string;
  emailInvalid: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  passwordHint: string;
  passwordTooShort: string;
  displayNameLabel: string;
  displayNamePlaceholder: string;
  displayNameRequired: string;
  /** Plantilla con `{terms}` y `{privacy}`. */
  terms: string;
  termsLinkLabel: string;
  privacyLinkLabel: string;
  termsRequired: string;
  successTitle: string;
  /** Plantilla con `{url}`. */
  successBody: string;
  successOpen: string;
  slugTakenNotice: string;
  invalidNotice: string;
  errorNotice: string;
  /** Place-first: no se pudo crear la cuenta (p. ej. email ya registrado). */
  accountFailedNotice: string;
  // Modo de paleta: predefinidas vs. personalizado (custom hex). El owner
  // elige uno explícitamente (`producto.md` §30 customización activa).
  /** Label del segmented control "¿Cómo elegís los colores?". */
  paletteModeLabel: string;
  paletteModePreset: string;
  paletteModeCustom: string;
  /** Encabezado del bloque "Personalizado" (3 inputs hex). */
  paletteCustomTitle: string;
  paletteCustomAccentLabel: string;
  paletteCustomBgLabel: string;
  paletteCustomInkLabel: string;
  /** Feedback calmo bajo un input hex que no parsea — NO bloquea submit. */
  paletteCustomHexInvalid: string;
  /** Sufijo aria-label del `<input type="color">` por canal. */
  paletteCustomPickerSuffix: string;
}
