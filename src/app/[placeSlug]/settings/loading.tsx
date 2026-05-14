/**
 * Skeleton de la landing de Settings (`/settings`). Page placeholder
 * hasta Fase 2/4 — un solo bloque de título + descripción. Sin
 * animaciones (CLAUDE.md cozytech). Tailwind neutrals (admin chrome).
 */
export default function SettingsLoading() {
  return (
    <div className="px-3 py-6 md:px-4 md:py-8" aria-busy="true" aria-live="polite">
      <div className="h-9 w-64 rounded bg-neutral-200" />
      <div className="mt-3 h-4 w-80 rounded bg-neutral-200" />
    </div>
  )
}
