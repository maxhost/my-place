import type {
  CreatePlaceInput,
  CreatePlaceResult,
} from "@/features/place-creation/public";
import type { StyleSuggestionResult } from "@/features/style-assist/public";

// Tipos del wizard (S8b). Separados del componente para no exceder el límite
// de archivo (CLAUDE.md ≤300) y para que la ruta + los pasos compartan el
// contrato de textos sin acoplarse al cliente.

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

// Asistencia LLM propose-only (S10b, ADR-0005 §5/§6 / ADR-0007). Seam-split
// idéntico a `WizardSubmit`: el Server Action vivo (`suggestStyleAction` del
// slice `style-assist`) se inyecta como prop en la ruta — el wizard no importa
// `style-assist` (sólo el tipo del resultado vía su `public.ts`: arista
// feature→feature type-only, unidireccional, acíclica — ADR-0015). La firma
// espeja exactamente `suggestStyleAction(description)`. Es OPCIONAL: si la ruta
// no la cablea, la isla no se renderiza (la asistencia es opcional por
// principio — ADR-0005 §5; degradación elegante también ante `unavailable`).
export type WizardSuggest = (
  description: string,
) => Promise<StyleSuggestionResult>;

export interface WizardLabels {
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
  guardrailNotice: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  descriptionHint: string;
  descriptionTooLong: string;
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
  // Isla de asistencia propose-only (S10b). Tono calmo, nada grita
  // (`producto.md` cozytech); nada se auto-aplica (ADR-0005 §6).
  assistButton: string;
  assistLoading: string;
  /** Cuando no hay descripción todavía: por qué el botón está en pausa. */
  assistNeedDescription: string;
  /** `unavailable` / falla: aviso tranquilo que NO bloquea. */
  assistUnavailable: string;
  assistProposedTitle: string;
  assistProposedHint: string;
  assistPaletteLabel: string;
  assistDescriptionLabel: string;
  assistApplyPalette: string;
  assistApplyDescription: string;
  assistApplied: string;
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
