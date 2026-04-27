/**
 * Skeleton del listado de eventos. Refleja la estructura real:
 * header con título Fraunces + CTA "Proponer evento" + lista de bento
 * cards (primer evento hero + resto en grid). Sin animaciones — bloques
 * quietos en `bg-soft`.
 *
 * Vive en `(gated)/events/loading.tsx` para que Next lo use como
 * Suspense fallback durante el RSC streaming. Coordinado con el
 * `<ZoneSwiper>` (R.2.5): el snap dispara router.push, el swiper
 * resetea su transform a x=0 vía useLayoutEffect, y este skeleton
 * renderiza dentro del swiper hasta que el page real esté listo.
 */
export default function EventsLoading() {
  return (
    <div className="flex flex-col gap-6 p-4 pb-6 md:p-8" aria-busy="true" aria-live="polite">
      {/* Header: título + CTA */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="h-7 w-32 rounded bg-soft" />
          <div className="mt-2 h-4 w-64 rounded bg-soft" />
        </div>
        <div className="h-9 w-32 shrink-0 rounded-md bg-soft" />
      </div>

      {/* Featured event (hero card) */}
      <div className="h-[180px] rounded-[18px] border-[0.5px] border-border bg-soft" />

      {/* Resto de eventos */}
      <div className="grid grid-cols-1 gap-3">
        <div className="h-[100px] rounded-[14px] border-[0.5px] border-border bg-soft" />
        <div className="h-[100px] rounded-[14px] border-[0.5px] border-border bg-soft" />
      </div>
    </div>
  )
}
