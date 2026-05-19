"use client";

import { PlacePreview } from "./place-preview";
import { usePlaceWizard } from "./use-place-wizard";
import type {
  WizardLabels,
  WizardSubmit,
  WizardSuggest,
} from "./wizard-labels";
import { Step1Identity, Step2Style, Step3Account } from "./wizard-steps";
import { SuccessPanel } from "./wizard-success";

export type {
  WizardLabels,
  WizardSubmit,
  WizardSuggest,
  PlaceFirstCredentials,
} from "./wizard-labels";

// Wizard place-first completo (S8b): shell + Paso 1 (identidad) + Paso 2
// (estilo) + Paso 3 (cuenta) + submit + estados post-falla. Componente
// CLIENTE; la máquina de estado vive en `usePlaceWizard` (separación +
// límite de archivo). Recibe textos por prop `labels` (serializable, sin
// runtime i18n) y el submit por prop `onSubmit` (seam-split: el Server
// Action vivo se cablea en la ruta; acá se inyecta para testear sin
// `next/headers`/Neon — mismo patrón S5b/S8a).
//
// `producto.md` cozytech: nada grita, sin urgencia. El progreso es calmo
// ("Paso n de 3"), los avisos son tranquilos y nunca bloquean con alarma.

export function PlaceWizard({
  labels,
  rootDomain,
  termsHref,
  privacyHref,
  onSubmit,
  onSuggest,
  authed = false,
}: {
  labels: WizardLabels;
  rootDomain: string;
  termsHref: string;
  privacyHref: string;
  onSubmit: WizardSubmit;
  /**
   * Asistencia LLM propose-only (S10b). Opcional: si la ruta no la cablea,
   * la isla del Paso 2 no se renderiza (ADR-0005 §5). Seam-split: el Server
   * Action vivo se inyecta acá (como `onSubmit`).
   */
  onSuggest?: WizardSuggest;
  /** Vía "Acceso" (S9): reutiliza el wizard sin el Paso 3 (cuenta). */
  authed?: boolean;
}) {
  const w = usePlaceWizard({ labels, onSubmit, onSuggest, authed });

  if (w.result?.status === "created") {
    return (
      <SuccessPanel
        labels={labels}
        result={w.result}
        rootDomain={rootDomain}
      />
    );
  }

  return (
    <section className="mx-auto grid w-full max-w-[64rem] gap-10 px-6 py-12 md:grid-cols-[1.05fr_0.95fr]">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-3xl text-ink">{labels.title}</h1>
          <p className="text-sm text-muted">{w.progress}</p>
        </header>

        <h2 className="text-xl text-ink">
          {labels.stepTitles[w.currentStep]}
        </h2>

        {w.noticeText && (
          <p
            className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-ink"
            aria-live="polite"
          >
            {w.noticeText}
          </p>
        )}

        {w.currentStep === 0 && (
          <Step1Identity
            labels={labels}
            ids={{
              name: w.ids.name,
              slug: w.ids.slug,
              slugMsg: w.ids.slugMsg,
            }}
            name={w.name}
            nameTouched={w.nameTouched}
            nameValid={w.nameValid}
            slug={w.slug}
            slugState={w.slugState}
            normalized={w.normalized}
            rootDomain={rootDomain}
            onName={w.onNameChange}
            onNameBlur={() => w.setNameTouched(true)}
            onSlug={(v) => {
              w.setSlug(v);
              w.setSlugTouched(true);
            }}
          />
        )}

        {w.currentStep === 1 && (
          <Step2Style
            labels={labels}
            ids={{ desc: w.ids.desc }}
            description={w.description}
            descTooLong={w.descTooLong}
            selectedPaletteId={w.paletteId}
            onDescription={w.setDescription}
            onPalette={w.choosePreset}
            assist={
              w.suggestEnabled
                ? {
                    phase: w.suggestPhase,
                    suggestReady: w.suggestReady,
                    canSuggest: w.canSuggest,
                    suggestion: w.suggestion,
                    paletteApplied: w.paletteApplied,
                    descriptionApplied: w.descriptionApplied,
                    onSuggest: w.handleSuggest,
                    onApplyPalette: w.applySuggestedPalette,
                    onApplyDescription: w.applySuggestedDescription,
                  }
                : undefined
            }
          />
        )}

        {!authed && w.currentStep === 2 && (
          <Step3Account
            labels={labels}
            ids={{
              email: w.ids.email,
              password: w.ids.password,
              displayName: w.ids.displayName,
            }}
            email={w.email}
            emailTouched={w.emailTouched}
            emailValid={w.emailValid}
            password={w.password}
            passwordTouched={w.passwordTouched}
            passwordValid={w.passwordValid}
            displayName={w.displayName}
            displayNameTouched={w.displayNameTouched}
            displayNameValid={w.displayNameValid}
            terms={w.terms}
            termsHref={termsHref}
            privacyHref={privacyHref}
            onEmail={(v) => {
              w.setEmail(v);
              w.setEmailTouched(true);
            }}
            onPassword={(v) => {
              w.setPassword(v);
              w.setPasswordTouched(true);
            }}
            onDisplayName={(v) => {
              w.setDisplayName(v);
              w.setDisplayNameTouched(true);
            }}
            onTerms={w.setTerms}
          />
        )}

        <footer className="flex items-center gap-3 pt-2">
          <button
            type="button"
            disabled={w.currentStep === 0 || w.submitting}
            onClick={w.goBack}
            className="inline-flex min-h-[2.75rem] items-center rounded-lg border border-border px-5 text-base text-ink disabled:opacity-40"
          >
            {labels.back}
          </button>
          <button
            type="button"
            disabled={
              w.submitting ||
              (w.isLastStep ? !w.submitValid : !w.stepValid[w.currentStep])
            }
            onClick={w.isLastStep ? w.handleSubmit : w.goNext}
            className="cta inline-flex min-h-[2.75rem] items-center rounded-lg px-6 text-base font-medium disabled:opacity-40"
          >
            {w.submitting
              ? labels.creating
              : w.isLastStep
                ? labels.create
                : labels.next}
          </button>
        </footer>
      </div>

      <aside className="md:pt-2">
        <PlacePreview
          name={w.name}
          palette={w.selectedPalette}
          labels={{
            previewLabel: labels.previewLabel,
            previewEmptyName: labels.previewEmptyName,
            guardrailNotice: labels.guardrailNotice,
          }}
        />
      </aside>
    </section>
  );
}
