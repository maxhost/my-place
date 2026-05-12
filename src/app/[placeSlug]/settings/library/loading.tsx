/**
 * Skeleton del master pane de `/settings/library` (lista de categorías).
 * Bloques quietos (CLAUDE.md cozytech) — sin spinners. Aplica el padding
 * canónico `px-3 py-6 md:px-4 md:py-8` post-rediseño master-detail.
 */
export default function SettingsLibraryLoading(): React.ReactNode {
  return (
    <div className="space-y-6 px-3 py-6 md:px-4 md:py-8" aria-busy="true" aria-live="polite">
      {/* PageHeader */}
      <header className="space-y-2">
        <div className="h-9 w-40 rounded bg-soft" />
        <div className="h-3 w-3/4 rounded bg-soft" />
      </header>
      {/* Section heading */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="h-7 w-32 rounded bg-soft" />
        <div className="h-3 w-12 rounded bg-soft" />
      </div>
      {/* Lista de categorías */}
      <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="flex min-h-[56px] items-center gap-3 px-3 py-3">
            <div className="h-8 w-8 shrink-0 rounded bg-soft" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/2 rounded bg-soft" />
              <div className="h-3 w-2/3 rounded bg-soft" />
            </div>
          </li>
        ))}
      </ul>
      {/* + Nueva categoría placeholder */}
      <div className="h-12 w-full rounded-md bg-soft" />
    </div>
  )
}
