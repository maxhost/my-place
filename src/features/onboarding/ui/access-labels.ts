import type { PlaceFirstCredentials } from "./wizard-labels";

// Tipos/contratos de la vía "Acceso" (S9, ADR-0008/0009). Separados del
// componente para no exceder el límite de archivo (CLAUDE.md ≤300) y para que
// la ruta y el cliente compartan el contrato sin acoplarse. Mismo seam-split
// que S8b: textos por `labels`, borde cross-system (Neon Auth) por puertos.

/** Datos de cuenta para el signup account-first (= shape del wizard). */
export type AccessCredentials = PlaceFirstCredentials;

/**
 * Resultado del borde de autenticación. Calmo y honesto (cozytech): no se
 * expone el detalle del SDK. `login_failed` cubre email/contraseña inválidos
 * o transporte; `signup_failed` cubre email ya registrado o transporte (el
 * aviso sugiere iniciar sesión, la causa más probable, sin afirmar un código
 * de error del SDK no verificado — TBD verificado en preview, no asumido).
 */
export type AccessResult =
  | { status: "ok" }
  | { status: "login_failed" }
  | { status: "signup_failed" };

/**
 * Puerto cross-system de la vía Acceso (mismo patrón que `WizardSubmit`): la
 * ruta cablea los Server Actions vivos (`loginAction`/`signUpAccountAction`),
 * los tests inyectan fakes. El wiring del SDK Neon Auth no es vitest-testeable
 * (arrastra `next/headers` + Neon) → su correctitud es tipo/build + preview.
 */
export interface AccessSubmit {
  login: (email: string, password: string) => Promise<AccessResult>;
  signUp: (credentials: AccessCredentials) => Promise<AccessResult>;
}

export interface AccessLabels {
  title: string;
  subtitle: string;
  loginTab: string;
  signupTab: string;
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
  loginSubmit: string;
  signupSubmit: string;
  submitting: string;
  loginFailedNotice: string;
  signupFailedNotice: string;
  choiceTitle: string;
  choiceSubtitle: string;
  createPlace: string;
  createPlaceDesc: string;
  joinPlace: string;
  joinPlaceDesc: string;
  comingSoon: string;
  back: string;
}
