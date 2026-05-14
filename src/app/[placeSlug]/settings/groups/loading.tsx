/**
 * Skeleton de `/settings/groups`. Refleja el shell real: PageHeader +
 * heading "Grupos" + count + lista minimalista de rows (post refactor
 * mayo 2026). Bloques quietos (CLAUDE.md cozytech). Tailwind neutrals
 * (settings es admin chrome).
 */
export default function SettingsGroupsLoading() {
  return (
    <div className="space-y-6 px-3 py-6 md:px-4 md:py-8" aria-busy="true" aria-live="polite">
      <header className="space-y-2">
        <div className="h-9 w-40 rounded bg-neutral-200" />
        <div className="h-3 w-3/4 rounded bg-neutral-200" />
      </header>
      <section className="space-y-3">
        <div className="border-b border-neutral-200 pb-2">
          <div className="h-6 w-24 rounded bg-neutral-200" />
        </div>
        <div className="h-3 w-32 rounded bg-neutral-200" />
        <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center justify-between py-3">
              <div className="space-y-2">
                <div className="h-4 w-44 rounded bg-neutral-200" />
                <div className="h-3 w-32 rounded bg-neutral-200" />
              </div>
              <div className="h-5 w-12 rounded-full bg-neutral-200" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
