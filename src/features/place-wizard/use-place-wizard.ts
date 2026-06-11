import { useId } from "react";
import { type Locale, routing } from "@/i18n/routing";
import { useAccountStep } from "./use-account-step";
import { useCreateSubmit } from "./use-create-submit";
import { useIdentityStep } from "./use-identity-step";
import { useStyleStep } from "./use-style-step";
import { useWizardNav } from "./use-wizard-nav";
import type {
  WizardLabels,
  WizardSignUp,
  WizardSubmit,
} from "./wizard-labels";

/**
 * usePlaceWizard — máquina del wizard place-first. Orquesta 5 sub-hooks
 * por dominio. Mapa para navegar el código:
 *
 *   1. Navegación (paso actual, next/back)     → ./use-wizard-nav.ts
 *   2. Paso 1 — identidad (nombre + slug)      → ./use-identity-step.ts
 *   3. Paso 2 — estilo (paleta preset/custom)  → ./use-style-step.ts
 *   4. Paso 3 — cuenta (place-first)           → ./use-account-step.ts
 *   5. Submit two-phase + avisos               → ./use-create-submit.ts
 *
 * Cruces (wireados acá para no contaminar los sub-hooks):
 *   - `goNext`/`goBack` también limpian `notice` del submit (1+5).
 *
 * Histórico:
 *   - Refactor 2026-05-20: 342 LOC → sub-hooks (CLAUDE.md ≤300/archivo).
 *   - ADR-0019 (2026-05-20): UI glue del LLM movida a slice `style-assist`.
 *   - ADR-0020 (2026-05-19): asistencia LLM pausada — sub-hook 4/6 anterior
 *     (`use-style-assist`) y sus cruces con choosePreset/setPaletteMode
 *     eliminados; el orquestador pasa de 6 a 5 sub-hooks.
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
   * Locale inicial del Paso 1 (ADR-0022 + ADR-0024). El owner puede cambiarlo
   * con el selector del Paso 1 (UI en S2b.2). Optional con default
   * `routing.defaultLocale` ('es') para no regresar mientras `crear/page.tsx`
   * aún no cablea explícitamente el locale del path — el zod hoy también
   * defaultea a 'es', así que el comportamiento end-to-end es idéntico.
   */
  defaultLocale?: Locale;
}) {
  const { labels, authed = false } = opts;
  const stepCount = labels.stepTitles.length;

  const nav = useWizardNav(stepCount);
  const { currentStep, isLastStep } = nav;
  const identity = useIdentityStep(opts.defaultLocale ?? routing.defaultLocale);
  const account = useAccountStep();
  const style = useStyleStep();

  // Validez por paso (cross-domain — se compone acá) + validez del submit
  // (en authed el último paso es Estilo; en place-first es Cuenta). El Paso 2
  // ya no tiene validación bloqueante tras quitar el campo descripción
  // (ADR-0020) — la paleta siempre es válida (preset o custom hex parseable).
  const stepValid = [identity.step1Valid, true, account.step3Valid];
  const submitValid = authed ? identity.step1Valid : account.step3Valid;

  const submit = useCreateSubmit({
    authed,
    onCreateAccount: opts.onCreateAccount,
    onSubmit: opts.onSubmit,
    submitValid,
    buildInputCore: () => ({
      name: identity.name.trim(),
      slug: identity.normalized,
      theme: style.selectedPalette,
      // ADR-0022 + ADR-0024: el locale del place viaja del Paso 1 al payload.
      // Zod lo valida contra `routing.locales` y lo propaga al SP (S2a.2).
      defaultLocale: identity.defaultLocale,
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

  // 6 ids cross-step para accesibilidad (label/aria-describedby). Viven acá
  // para mantener el orden estable de hooks entre renders (React rule).
  const ids = {
    name: useId(),
    slug: useId(),
    slugMsg: useId(),
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
        rate_limited: labels.rateLimitedNotice,
        error: labels.errorNotice,
      }[submit.notice]
    : null;

  // Spread de los sub-hooks (cada uno expone su superficie pública). Los
  // wrappers cross-domain (goNext/goBack) van explícitos al final para
  // sobreescribir las versiones planas. Los derivados cross-domain
  // (stepValid/submitValid/progress/noticeText/ids) también explícitos.
  return {
    ...nav,
    ...identity,
    ...style,
    ...account,
    ...submit,
    ids,
    progress,
    noticeText,
    stepValid,
    submitValid,
    goNext,
    goBack,
  };
}
