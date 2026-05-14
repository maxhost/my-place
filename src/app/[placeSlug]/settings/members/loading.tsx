/**
 * Skeleton del directorio de miembros (`/settings/members`). Refleja el
 * shell real: PageHeader + searchbar + tabs + lista con divisores. Bloques
 * quietos (CLAUDE.md cozytech). Tailwind neutrals (settings es admin chrome).
 */
export default function SettingsMembersLoading() {
  return (
    <div className="space-y-6 px-3 py-6 md:px-4 md:py-8" aria-busy="true" aria-live="polite">
      <header className="space-y-2">
        <div className="h-9 w-48 rounded bg-neutral-200" />
        <div className="h-3 w-2/3 rounded bg-neutral-200" />
      </header>
      <div className="h-11 w-full rounded-md bg-neutral-100" />
      <div className="flex items-center gap-2">
        <div className="h-11 w-24 rounded-full bg-neutral-200" />
        <div className="h-11 w-24 rounded-full bg-neutral-100" />
      </div>
      <section className="space-y-3">
        <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="flex items-center justify-between py-3">
              <div className="space-y-2">
                <div className="h-4 w-40 rounded bg-neutral-200" />
                <div className="h-3 w-24 rounded bg-neutral-200" />
              </div>
              <div className="h-5 w-16 rounded-full bg-neutral-200" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
