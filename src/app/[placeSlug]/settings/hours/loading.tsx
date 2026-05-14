/**
 * Skeleton de `/settings/hours`. Refleja el shell real: header (PageHeader)
 * + sección "Estado actual" + form de horario. Bloques quietos (CLAUDE.md
 * cozytech). Tailwind neutrals (settings es admin chrome).
 */
export default function SettingsHoursLoading() {
  return (
    <div className="space-y-6 px-3 py-6 md:px-4 md:py-8" aria-busy="true" aria-live="polite">
      <header className="space-y-2">
        <div className="h-9 w-40 rounded bg-neutral-200" />
        <div className="h-3 w-2/3 rounded bg-neutral-200" />
      </header>
      <section className="space-y-2 rounded-md border border-neutral-200 bg-neutral-100 p-4">
        <div className="h-3 w-32 rounded bg-neutral-200" />
        <div className="h-5 w-1/2 rounded bg-neutral-200" />
      </section>
      <section className="space-y-3">
        <div className="h-5 w-44 rounded bg-neutral-200" />
        <div className="h-32 rounded-md border border-neutral-200 bg-neutral-100" />
        <div className="h-10 w-32 rounded-md bg-neutral-200" />
      </section>
    </div>
  )
}
