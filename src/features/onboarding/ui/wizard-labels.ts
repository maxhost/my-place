import type { CreatePlaceResult } from "../create-place";
import type { CreatePlaceInput } from "../domain/schema";

// Tipos del wizard (S8b). Separados del componente para no exceder el límite
// de archivo (CLAUDE.md ≤300) y para que la ruta + los pasos compartan el
// contrato de textos sin acoplarse al cliente.

export interface PlaceFirstCredentials {
  email: string;
  password: string;
  displayName: string;
}

export type WizardSubmit = (
  input: CreatePlaceInput,
  credentials: PlaceFirstCredentials,
) => Promise<CreatePlaceResult>;

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
}
