/**
 * Skeleton del listado de discusiones (R.6) reflejando la estructura
 * real del rediseño: chip + filter pills + featured card + 3 rows con
 * hairline divider. Sin animaciones ruidosas — bloques quietos en
 * `bg-soft` que desaparecen al montar la page real.
 *
 * Restaurado en R.2.5.2-fix tras observar que el approach de
 * "startTransition + UI viejo" se sentía frozen 4-12s en dev mode
 * (pgbouncer high-latency). Skeletons explícitos son production-honest
 * y juegan limpio con el swiper: el snap completa la animación
 * off-screen → router.push → loading.tsx renderiza dentro del swiper
 * (reset a x=0 vía useLayoutEffect) → contenido real reemplaza al
 * skeleton. Ver `docs/features/shell/spec.md` § 16.4.
 */
export default function ConversationsLoading() {
  return (
    <div className="flex flex-col gap-4 pb-6" aria-busy="true" aria-live="polite">
      {/* Section header: chip + título + CTA */}
      <div className="flex items-center gap-[18px] px-3 pt-6">
        <div className="h-14 w-14 shrink-0 rounded-[14px] border-[0.5px] border-border bg-soft" />
        <div className="h-9 flex-1 rounded bg-soft" />
        <div className="h-9 w-16 shrink-0 rounded-[10px] border-[0.5px] border-border bg-soft" />
      </div>
      {/* Filter pills */}
      <div className="flex gap-1.5 px-3 py-1">
        <div className="h-9 w-16 rounded-full bg-soft" />
        <div className="h-9 w-28 rounded-full bg-soft" />
        <div className="h-9 w-40 rounded-full bg-soft" />
      </div>
      {/* Featured thread placeholder */}
      <div className="mx-3 h-[140px] rounded-[18px] border-[0.5px] border-border bg-soft" />
      {/* Rows */}
      <div className="divide-y divide-border border-y-[0.5px] border-border">
        <div className="h-20 px-3" />
        <div className="h-20 px-3" />
        <div className="h-20 px-3" />
      </div>
    </div>
  )
}
