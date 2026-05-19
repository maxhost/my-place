import { useState } from "react";

// Sub-hook 1/6: navegación entre pasos. El orquestador envuelve goNext/goBack
// para guard de validez + limpiar notice. Ver mapa en `use-place-wizard.ts`.

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
