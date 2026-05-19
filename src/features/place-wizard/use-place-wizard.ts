import { useId } from "react";
import { useStyleAssist } from "@/features/style-assist/public";
import { useAccountStep } from "./use-account-step";
import { useCreateSubmit } from "./use-create-submit";
import { useIdentityStep } from "./use-identity-step";
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
  // El LLM aplica `setCustomPalette(...)` directamente; con el modo `paletteMode`
  // explícito (no derivado, post-bug-fix), también hay que bascular el modo a
  // "custom" para que el preview/submit usen la propuesta. Wrapper acá para que
  // `useStyleAssist` no necesite conocer el modo. La descripción se eliminó
  // del wizard (ADR-0020): se pasa string vacío al hook (gating de la isla
  // queda en "necesita descripción" — innocuo: la isla también se elimina en
  // el commit siguiente del mismo ADR).
  const assist = useStyleAssist({
    onSuggest: opts.onSuggest,
    description: "",
    setCustomPalette: (p) => {
      style.setCustomPalette(p);
      style.setPaletteMode("custom");
    },
    setDescription: () => {},
  });

  // Envoltorios del cruce LLM↔paleta: cambiar de preset o volver al modo
  // "preset" invalida el "Aplicado" del LLM (`producto.md` §30 — el owner
  // tomó una decisión que reemplaza la propuesta). Pasar a "custom" no
  // resetea (la propuesta del LLM se aplica AL custom, son coherentes).
  function choosePreset(id: string) {
    style.choosePreset(id);
    assist.resetPaletteApplied();
  }
  function setPaletteMode(mode: PaletteMode) {
    style.setPaletteMode(mode);
    if (mode === "preset") assist.resetPaletteApplied();
  }

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
        error: labels.errorNotice,
      }[submit.notice]
    : null;

  // Spread de los sub-hooks (cada uno expone su superficie pública). Las
  // wrappers cross-domain (goNext/goBack/choosePreset/setPaletteMode) van
  // explícitas al final para sobreescribir las versiones planas si las hay.
  // Los derivados cross-domain (stepValid/submitValid/progress/noticeText/
  // ids) también explícitos.
  return {
    ...nav,
    ...identity,
    ...style,
    ...assist,
    ...account,
    ...submit,
    ids,
    progress,
    noticeText,
    stepValid,
    submitValid,
    choosePreset,
    setPaletteMode,
    goNext,
    goBack,
  };
}
