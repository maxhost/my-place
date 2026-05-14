/**
 * Skeleton de `/settings/tiers`. Refleja el shell real: PageHeader +
 * lista de tiers + CTA dashed para crear nuevo. Bloques quietos
 * (CLAUDE.md cozytech). Tailwind neutrals (settings es admin chrome).
 */
export default function SettingsTiersLoading() {
  return (
    <div className="space-y-6 px-3 py-6 md:px-4 md:py-8" aria-busy="true" aria-live="polite">
      <header className="space-y-2">
        <div className="h-9 w-40 rounded bg-neutral-200" />
        <div className="h-3 w-3/4 rounded bg-neutral-200" />
      </header>
      <section className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-md border border-neutral-200 bg-neutral-100" />
        ))}
        <div className="h-14 rounded-md border border-dashed border-neutral-300" />
      </section>
    </div>
  )
}
