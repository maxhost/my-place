'use client'

import { useWizardContext } from './wizard-context'

/**
 * Body del wizard primitive.
 *
 * Renderiza el componente del step actual con las props inyectadas
 * (`value`, `onChange`, `onValid`). El consumer del wizard NO renderiza
 * el step manualmente — el wizard orquesta cuál Component instanciar
 * según `currentIndex`.
 *
 * **Layout (S5.1, 2026-05-13):** `flex-1 min-h-0 overflow-y-auto` para
 * que el body scrollee internamente cuando el contenido excede el
 * viewport. Sin esto, listas largas (e.g. picker de usuarios con N=150)
 * expanden el body hasta empujar el footer fuera del viewport. Requiere
 * que el container externo (EditPanel, BottomSheet) sea `flex flex-col`
 * con altura definida.
 */
export function WizardBody(): React.ReactNode {
  const { steps, currentIndex, value, setValue, setStepValid } = useWizardContext<unknown>()
  const current = steps[currentIndex]
  if (current === undefined) return null
  const StepComponent = current.Component

  return (
    <div className="flex-1 overflow-y-auto py-4" style={{ minHeight: 0 }}>
      <StepComponent
        value={value}
        onChange={setValue}
        onValid={(isValid) => setStepValid(current.id, isValid)}
      />
    </div>
  )
}
