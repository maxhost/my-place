/**
 * Skeleton de `/settings/access` (panel de ownership). Refleja el shell
 * real: PageHeader + lista de owners + acciones. Bloques quietos
 * (CLAUDE.md cozytech). Tailwind neutrals (settings es admin chrome).
 */
export default function SettingsAccessLoading() {
  return (
    <div className="space-y-6 px-3 py-6 md:px-4 md:py-8" aria-busy="true" aria-live="polite">
      {/* PageHeader */}
      <header className="space-y-2">
        <div className="h-9 w-40 rounded bg-neutral-200" />
        <div className="h-3 w-2/3 rounded bg-neutral-200" />
      </header>
      {/* Owners list + actions */}
      <section className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-md border border-neutral-200 bg-neutral-100 p-3"
          >
            <div className="h-10 w-10 shrink-0 rounded-full bg-neutral-200" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/3 rounded bg-neutral-200" />
              <div className="h-3 w-1/4 rounded bg-neutral-200" />
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
