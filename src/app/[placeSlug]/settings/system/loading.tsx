/**
 * Skeleton de `/settings/system`. Refleja el shell real: PageHeader + sección
 * "Salir del place" con copy + botón. Bloques quietos (CLAUDE.md cozytech).
 */
export default function SettingsSystemLoading() {
  return (
    <div className="space-y-6 px-3 py-6 md:px-4 md:py-8" aria-busy="true" aria-live="polite">
      {/* PageHeader */}
      <header className="space-y-2">
        <div className="h-9 w-40 rounded bg-soft" />
        <div className="h-3 w-2/3 rounded bg-soft" />
      </header>
      {/* Section "Salir del place": h2 + copy + botón */}
      <section className="space-y-3">
        <div className="space-y-2">
          <div className="h-6 w-44 rounded bg-soft" />
          <div className="h-3 w-3/4 rounded bg-soft" />
          <div className="h-3 w-1/2 rounded bg-soft" />
        </div>
        <div className="h-12 w-full rounded-md bg-soft" />
      </section>
    </div>
  )
}
