'use client'

import { Toaster as SonnerToaster, toast } from 'sonner'

/**
 * Wrapper fino sobre Sonner con defaults calmos: bottom-right, 4s, sin
 * richColors (vivimos en el palette del place). `role="status"` +
 * `aria-live="polite"` son nativos de Sonner.
 *
 * Se monta una sola vez en `src/app/layout.tsx`. Las features llaman `toast()`
 * desde `@/shared/ui/toaster`.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      richColors={false}
      duration={4000}
      closeButton={false}
      style={{
        // Z-index por encima del Dialog (z-50) para que el toast aparezca
        // sobre el diálogo si uno queda abierto al disparar el toast.
        zIndex: 60,
      }}
      toastOptions={{
        style: {
          background: 'var(--surface)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
        },
      }}
    />
  )
}

export { toast }
