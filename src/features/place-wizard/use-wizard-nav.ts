import { useState } from "react";

// use-wizard-nav.ts — Sub-hook 1/6 de `use-place-wizard`.
// Navegación entre los pasos del wizard place-first (Paso 1/2/3, o 1/2 en
// modo authed). Autónomo: no consume otros sub-hooks. El orquestador
// (`use-place-wizard.ts`) envuelve `goNext`/`goBack` para sumar el guard de
// validez del paso y la limpieza de `notice` del submit (cruces documentados
// en el header del orquestador).

export function useWizardNav(stepCount: number) {
  const [currentStep, setCurrentStep] = useState(0);
  const isLastStep = currentStep === stepCount - 1;

  function goNext() {
    setCurrentStep((s) => Math.min(stepCount - 1, s + 1));
  }
  function goBack() {
    setCurrentStep((s) => Math.max(0, s - 1));
  }
  function resetToFirstStep() {
    setCurrentStep(0);
  }

  return { currentStep, isLastStep, goNext, goBack, resetToFirstStep };
}
