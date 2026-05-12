/**
 * Skeleton del detail pane de `/settings/library/[categoryId]`. Refleja la
 * estructura real: back link mobile + PageHeader + 3 sections (info,
 * contributors opcional, archive). Bloques quietos.
 */
export default function SettingsLibraryCategoryLoading(): React.ReactNode {
  return (
    <div className="space-y-6 px-3 py-6 md:px-4 md:py-8" aria-busy="true" aria-live="polite">
      {/* Back link mobile */}
      <div className="h-3 w-32 rounded bg-soft md:hidden" />
      {/* PageHeader */}
      <header className="space-y-2">
        <div className="h-9 w-2/3 rounded bg-soft" />
        <div className="h-3 w-1/2 rounded bg-soft" />
      </header>
      {/* Section Información */}
      <section className="space-y-3">
        <div className="h-7 w-32 rounded bg-soft" />
        <div className="space-y-3 rounded-md border border-neutral-200 px-3 py-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex justify-between gap-3">
              <div className="h-3 w-1/4 rounded bg-soft" />
              <div className="h-3 w-1/3 rounded bg-soft" />
            </div>
          ))}
        </div>
        <div className="h-11 w-full rounded-md bg-soft" />
      </section>
      {/* Section Archivar */}
      <section className="space-y-3">
        <div className="h-7 w-24 rounded bg-soft" />
        <div className="h-3 w-3/4 rounded bg-soft" />
        <div className="h-11 w-full rounded-md bg-soft" />
      </section>
    </div>
  )
}
