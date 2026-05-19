import { useId, useRef, useState } from "react";
import { useAccountStep } from "./use-account-step";
import { useIdentityStep } from "./use-identity-step";
import { useStyleAssist } from "./use-style-assist";
import { useStyleStep } from "./use-style-step";
import { useWizardNav } from "./use-wizard-nav";
import {
  type CreatePlaceInput,
  type CreatePlaceResult,
} from "@/features/place-creation/public";
import type {
  WizardLabels,
  WizardSignUp,
  WizardSubmit,
  WizardSuggest,
} from "./wizard-labels";

// Máquina de estado del wizard (S8b), separada del render para no exceder el
// límite de archivo (CLAUDE.md ≤300) y para testear la UI por comportamiento.
// El estado vive client-side hasta el submit; idempotencia por ref.

type Notice = "slug_taken" | "invalid" | "error" | "account" | null;

// tz del browser con fallback fijo a "UTC" (IANA válido → pasa
// `timezoneSchema`). El owner ajusta el horario luego en `/settings`.
function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

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
  const {
    name,
    nameTouched,
    nameValid,
    slug,
    slugState,
    normalized,
    isValid: step1Valid,
    onNameChange,
  } = identity;
  const account = useAccountStep();
  const {
    email,
    emailTouched,
    emailValid,
    password,
    passwordTouched,
    passwordValid,
    displayName,
    displayNameTouched,
    displayNameValid,
    terms,
    isValid: step3Valid,
  } = account;
  // Ref-dispatch para el cruce LLM↔preset (chicken-and-egg): use-style-step
  // se inicializa ANTES que use-style-assist, así que `onPresetChosen` no
  // puede ver `assist.resetPaletteApplied` en tiempo de declaración. La ref
  // se setea después y los event handlers (call-time) la leen actualizada.
  const resetPaletteAppliedRef = useRef<() => void>(() => {});
  const style = useStyleStep({
    onPresetChosen: () => resetPaletteAppliedRef.current(),
  });
  const { description, descTooLong, paletteId, customPalette, selectedPalette, paletteMode } = style;
  const assist = useStyleAssist({
    onSuggest: opts.onSuggest,
    description,
    setCustomPalette: style.setCustomPalette,
    setDescription: style.setDescription,
  });
  resetPaletteAppliedRef.current = assist.resetPaletteApplied;
  const {
    suggestPhase,
    suggestion,
    paletteApplied,
    descriptionApplied,
    suggestEnabled,
    canSuggest,
    suggestReady,
    handleSuggest,
    applySuggestedPalette,
    applySuggestedDescription,
  } = assist;
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [result, setResult] = useState<CreatePlaceResult | null>(null);
  const submittingRef = useRef(false);

  const ids = {
    name: useId(),
    slug: useId(),
    slugMsg: useId(),
    desc: useId(),
    email: useId(),
    password: useId(),
    displayName: useId(),
  };

  const stepValid = [step1Valid, !descTooLong, step3Valid];
  // Validez del último paso para habilitar "Crear": en authed el último paso
  // es Estilo (sin cuenta), en place-first es el Paso 3 (cuenta).
  const submitValid = authed ? step1Valid && !descTooLong : step3Valid;

  // Envoltorios de `nav.goNext`/`goBack` para sumar el guard de validez +
  // limpiar `notice` (cruce documentado en el header del orquestador).
  function goNext() {
    if (!stepValid[currentStep] || isLastStep) return;
    setNotice(null);
    nav.goNext();
  }
  function goBack() {
    setNotice(null);
    nav.goBack();
  }

  async function handleSubmit() {
    // Idempotencia: el ref bloquea reentradas aunque el estado aún no haya
    // re-renderizado (doble click). El submit nunca dispara dos veces.
    if (submittingRef.current || !submitValid) return;
    submittingRef.current = true;
    setSubmitting(true);
    setNotice(null);
    try {
      // FASE 1 (solo place-first): crear la cuenta. Es una request propia
      // que establece la cookie de sesión; sin "ok" no seguimos (sin sesión
      // la FASE 2 no podría obtener el JWT). En authed la sesión ya existe.
      if (!authed) {
        const acc = await opts.onCreateAccount?.({
          email: email.trim(),
          password,
          displayName: displayName.trim(),
        });
        if (!acc || acc.status !== "ok") {
          setNotice("account");
          return;
        }
      }
      // FASE 2: crear el place en modo authed. La cookie de la FASE 1 (o la
      // sesión preexistente en authed) viaja en ESTA request → el Server
      // Action obtiene el JWT vía `auth.token()`.
      const input: CreatePlaceInput = {
        name: name.trim(),
        slug: normalized,
        description: description.trim() || undefined,
        theme: selectedPalette,
        ownerTimezone: detectTimezone(),
      };
      const res = await opts.onSubmit(input);
      if (res.status === "created") setResult(res);
      else if (res.status === "slug_taken") {
        setNotice("slug_taken");
        nav.resetToFirstStep();
      } else setNotice("invalid");
    } catch {
      setNotice("error");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const progress = labels.progress
    .replace("{n}", String(currentStep + 1))
    .replace("{total}", String(stepCount));

  const noticeText: string | null = notice
    ? {
        slug_taken: labels.slugTakenNotice,
        account: labels.accountFailedNotice,
        invalid: labels.invalidNotice,
        error: labels.errorNotice,
      }[notice]
    : null;

  return {
    ids,
    currentStep,
    isLastStep,
    progress,
    noticeText,
    result,
    submitting,
    submitValid,
    stepValid,
    selectedPalette,
    name,
    nameTouched,
    nameValid,
    slug,
    slugState,
    normalized,
    description,
    descTooLong,
    paletteId,
    paletteMode,
    customPalette,
    suggestEnabled,
    suggestPhase,
    suggestReady,
    canSuggest,
    suggestion,
    paletteApplied,
    descriptionApplied,
    email,
    emailTouched,
    emailValid,
    password,
    passwordTouched,
    passwordValid,
    displayName,
    displayNameTouched,
    displayNameValid,
    terms,
    onNameChange,
    setNameTouched: identity.setNameTouched,
    setSlug: identity.setSlug,
    setSlugTouched: identity.setSlugTouched,
    setDescription: style.setDescription,
    setPaletteId: style.setPaletteId,
    choosePreset: style.choosePreset,
    setPaletteMode: style.setPaletteMode,
    setCustomHex: style.setCustomHex,
    handleSuggest,
    applySuggestedPalette,
    applySuggestedDescription,
    setEmail: account.setEmail,
    setEmailTouched: account.setEmailTouched,
    setPassword: account.setPassword,
    setPasswordTouched: account.setPasswordTouched,
    setDisplayName: account.setDisplayName,
    setDisplayNameTouched: account.setDisplayNameTouched,
    setTerms: account.setTerms,
    goNext,
    goBack,
    handleSubmit,
  };
}
