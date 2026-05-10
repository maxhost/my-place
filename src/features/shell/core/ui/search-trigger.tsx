'use client'

import { Search } from 'lucide-react'

/**
 * Botón de search en la TopBar. **Stub** en R.2 — no abre nada (el overlay
 * search es R.4). Visible y accesible: `aria-disabled="true"` +
 * `title="Próximamente"` comunican el estado sin esconder el botón
 * (preserva consistencia visual del chrome).
 *
 * Ver `docs/features/shell/spec.md` § 4 (componentes) y § 8 (a11y).
 */
export function SearchTrigger(): React.ReactNode {
  return (
    <button
      type="button"
      aria-label="Buscar"
      aria-disabled="true"
      title="Próximamente"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border-[0.5px] border-border bg-surface text-muted opacity-60 motion-safe:transition-colors"
    >
      <Search size={18} aria-hidden="true" />
    </button>
  )
}
