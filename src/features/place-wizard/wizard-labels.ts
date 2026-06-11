import type {
  CreatePlaceInput,
  CreatePlaceResult,
} from "@/features/place-creation/public";
import type { Locale } from "@/i18n/routing";

// Tipos del wizard (S8b). Separados del componente para no exceder el límite
// de archivo (CLAUDE.md ≤300) y para que la ruta + los pasos compartan el
// contrato de textos sin acoplarse al cliente.
//
// `guardrailNotice` vive acá (no en `style-assist`) porque el guardrail de
// contraste se aplica al preview/success de CUALQUIER paleta (preset o
// custom hex), no sólo a la propuesta del LLM. Lo consumen `place-preview`
// y `wizard-success`. La asistencia LLM propose-only está pausada por
// ADR-0020 — `WizardLabels` ya no extiende `StyleAssistLabels` ni declara
// keys assist*.

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
  /** Aviso calmo cuando el guardrail de contraste ajusta un color (preview/success). */
  guardrailNotice: string;
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
  /** Gate Upstash de `createPlaceAction` bloqueó el submit (S2 hardening). */
  rateLimitedNotice: string;
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
  // ADR-0022 (place.default_locale editable por owner) + ADR-0024 (6 locales
  // operativos día uno). El selector vive en el Paso 1; el owner elige el
  // idioma del chrome de su lugar (settings + member shell) al crearlo. La
  // ruta `crear/page.tsx` cablea `defaultLocale` desde el segmento `[locale]`.
  /** Label del radiogroup "¿En qué idioma habla tu lugar?". */
  defaultLocaleLabel: string;
  /**
   * Endonyms (auto-nombres) de cada locale operativo: "Español", "English",
   * "Français", "Português", "Deutsch", "Català". Endonyms = el lugar se
   * autonombra en su propio idioma, no se traducen según el chrome del owner.
   */
  defaultLocaleOptions: Record<Locale, string>;
}
