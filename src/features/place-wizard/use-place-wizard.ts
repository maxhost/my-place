import { useId } from "react";
import { useAccountStep } from "./use-account-step";
import { useCreateSubmit } from "./use-create-submit";
import { useIdentityStep } from "./use-identity-step";
import { useStyleAssist } from "./use-style-assist";
import { type PaletteMode, useStyleStep } from "./use-style-step";
import { useWizardNav } from "./use-wizard-nav";
import type {
  WizardLabels,
  WizardSignUp,
  WizardSubmit,
  WizardSuggest,
} from "./wizard-labels";

/**
 * usePlaceWizard — máquina del wizard place-first. Orquesta 6 sub-hooks
 * por dominio. Mapa para navegar el código:
 *
 *   1. Navegación (paso actual, next/back)     → ./use-wizard-nav.ts
 *   2. Paso 1 — identidad (nombre + slug)      → ./use-identity-step.ts
 *   3. Paso 2 — estilo (desc + paleta)         → ./use-style-step.ts
 *   4. Paso 2 — asistencia LLM (propose-only)  → ./use-style-assist.ts
 *   5. Paso 3 — cuenta (place-first)           → ./use-account-step.ts
 *   6. Submit two-phase + avisos               → ./use-create-submit.ts
 *
 * Cruces (wireados acá para no contaminar los sub-hooks):
 *   - `choosePreset` y `setPaletteMode("preset")` también resetean
 *     `paletteApplied` del LLM (3+4). Se compone acá (los sub-hooks son
 *     autónomos: ninguno conoce al otro).
 *   - `goNext`/`goBack` también limpian `notice` del submit (1+6).
 *
 * Refactor 2026-05-20 (cierra deuda de 342 LOC > 300 — CLAUDE.md). El
 * contrato de retorno es el mismo que antes del refactor; ningún consumer
 * (place-wizard.tsx, wizard-steps.tsx, tests) cambia.
 */
export function usePlaceWizard(opts: {
  labels: WizardLabels;
  onSubmit: WizardSubmit;
  /**
   * Modo authed (S9, vía "Acceso"): el usuario ya está autenticado → se
   * omite el Paso 3 (cuenta) y el submit no envía credenciales (ADR-0008 §3).
   * El nº de pasos lo da `labels.stepTitles.length` (la ruta pasa 2 títulos).
   */
  authed?: boolean;
  /**
   * Place-first: crea la cuenta en una request PREVIA (establece la cookie de
   * sesión) antes del `onSubmit` authed. Requerido cuando `!authed`.
   */
  onCreateAccount?: WizardSignUp;
  /**
   * Asistencia LLM propose-only (S10b). OPCIONAL: si no se cablea, la isla
   * no se renderiza (la asistencia es opcional — ADR-0005 §5).
   */
  onSuggest?: WizardSuggest;
}) {
  const { labels, authed = false } = opts;
  const stepCount = labels.stepTitles.length;

  const nav = useWizardNav(stepCount);
  const { currentStep, isLastStep } = nav;
  const identity = useIdentityStep();
  const account = useAccountStep();

  const style = useStyleStep();
  const assist = useStyleAssist({
    onSuggest: opts.onSuggest,
    description: style.description,
    setCustomPalette: style.setCustomPalette,
    setDescription: style.setDescription,
  });

  // Envoltorios del cruce LLM↔preset: elegir un preset (directo o vía modo)
  // invalida el "Aplicado" del LLM (`producto.md` §30 — preset gana).
  function choosePreset(id: string) {
    style.choosePreset(id);
    assist.resetPaletteApplied();
  }
  function setPaletteMode(mode: PaletteMode) {
    if (mode === "custom") style.activateCustomFromPreset();
    else choosePreset(style.paletteId);
  }

  // Validez por paso (cross-domain — se compone acá) + validez del submit
  // (en authed el último paso es Estilo; en place-first es Cuenta).
  const stepValid = [identity.isValid, !style.descTooLong, account.isValid];
  const submitValid = authed
    ? identity.isValid && !style.descTooLong
    : account.isValid;

  const submit = useCreateSubmit({
    authed,
    onCreateAccount: opts.onCreateAccount,
    onSubmit: opts.onSubmit,
    submitValid,
    buildInputCore: () => ({
      name: identity.name.trim(),
      slug: identity.normalized,
      description: style.description.trim() || undefined,
      theme: style.selectedPalette,
    }),
    buildCredentials: () => ({
      email: account.email.trim(),
      password: account.password,
      displayName: account.displayName.trim(),
    }),
    onSlugTaken: nav.resetToFirstStep,
  });

  // Envoltorios de navegación: guard de validez + limpiar `notice` del submit
  // (cruce documentado en el header).
  function goNext() {
    if (!stepValid[currentStep] || isLastStep) return;
    submit.clearNotice();
    nav.goNext();
  }
  function goBack() {
    submit.clearNotice();
    nav.goBack();
  }

  // 7 ids cross-step para accesibilidad (label/aria-describedby). Viven acá
  // para mantener el orden estable de hooks entre renders (React rule).
  const ids = {
    name: useId(),
    slug: useId(),
    slugMsg: useId(),
    desc: useId(),
    email: useId(),
    password: useId(),
    displayName: useId(),
  };

  const progress = labels.progress
    .replace("{n}", String(currentStep + 1))
    .replace("{total}", String(stepCount));

  const noticeText: string | null = submit.notice
    ? {
        slug_taken: labels.slugTakenNotice,
        account: labels.accountFailedNotice,
        invalid: labels.invalidNotice,
        error: labels.errorNotice,
      }[submit.notice]
    : null;

  return {
    ids,
    currentStep,
    isLastStep,
    progress,
    noticeText,
    result: submit.result,
    submitting: submit.submitting,
    submitValid,
    stepValid,
    selectedPalette: style.selectedPalette,
    name: identity.name,
    nameTouched: identity.nameTouched,
    nameValid: identity.nameValid,
    slug: identity.slug,
    slugState: identity.slugState,
    normalized: identity.normalized,
    description: style.description,
    descTooLong: style.descTooLong,
    paletteId: style.paletteId,
    paletteMode: style.paletteMode,
    customPalette: style.customPalette,
    suggestEnabled: assist.suggestEnabled,
    suggestPhase: assist.suggestPhase,
    suggestReady: assist.suggestReady,
    canSuggest: assist.canSuggest,
    suggestion: assist.suggestion,
    paletteApplied: assist.paletteApplied,
    descriptionApplied: assist.descriptionApplied,
    email: account.email,
    emailTouched: account.emailTouched,
    emailValid: account.emailValid,
    password: account.password,
    passwordTouched: account.passwordTouched,
    passwordValid: account.passwordValid,
    displayName: account.displayName,
    displayNameTouched: account.displayNameTouched,
    displayNameValid: account.displayNameValid,
    terms: account.terms,
    onNameChange: identity.onNameChange,
    setNameTouched: identity.setNameTouched,
    setSlug: identity.setSlug,
    setSlugTouched: identity.setSlugTouched,
    setDescription: style.setDescription,
    setPaletteId: style.setPaletteId,
    choosePreset,
    setPaletteMode,
    setCustomHex: style.setCustomHex,
    handleSuggest: assist.handleSuggest,
    applySuggestedPalette: assist.applySuggestedPalette,
    applySuggestedDescription: assist.applySuggestedDescription,
    setEmail: account.setEmail,
    setEmailTouched: account.setEmailTouched,
    setPassword: account.setPassword,
    setPasswordTouched: account.setPasswordTouched,
    setDisplayName: account.setDisplayName,
    setDisplayNameTouched: account.setDisplayNameTouched,
    setTerms: account.setTerms,
    goNext,
    goBack,
    handleSubmit: submit.handleSubmit,
  };
}
