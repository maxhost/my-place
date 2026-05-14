/**
 * Skeleton de `/settings/danger-zone`. Refleja el shell real: PageHeader +
 * 2 secciones (Transferir ownership owner-only + Salir del place). Bloques
 * quietos (CLAUDE.md cozytech).
 */
export default function SettingsDangerZoneLoading() {
  return (
    <div className="space-y-6 px-3 py-6 md:px-4 md:py-8" aria-busy="true" aria-live="polite">
      {/* PageHeader */}
      <header className="space-y-2">
        <div className="h-9 w-48 rounded bg-soft" />
        <div className="h-3 w-2/3 rounded bg-soft" />
      </header>
      {/* Sections genéricas: h2 + copy + control */}
      <section className="space-y-3">
        <div className="space-y-2">
          <div className="h-6 w-52 rounded bg-soft" />
          <div className="h-3 w-3/4 rounded bg-soft" />
          <div className="h-3 w-1/2 rounded bg-soft" />
        </div>
        <div className="h-12 w-full rounded-md bg-soft" />
      </section>
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
