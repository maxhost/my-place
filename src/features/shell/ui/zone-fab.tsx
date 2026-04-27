'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { FAB } from '@/shared/ui/fab'
import { DropdownMenuItem } from '@/shared/ui/dropdown-menu'
import { ZONES } from '../domain/zones'
import { isZoneRootPath } from '../domain/swiper-snap'

/**
 * Orquestador del FAB cross-zona (R.2.6) — wrappea el primitivo
 * `<FAB>` con la lógica de visibilidad y los items del menú.
 *
 * Visibilidad:
 *  - Solo zonas root (`/`, `/conversations`, `/events`) vía
 *    `isZoneRootPath` reusado de R.2.5 (mismo gate del swiper).
 *  - Sub-pages (thread detail, event detail, /m/, new forms): retorna
 *    null. El user está enfocado en algo específico, "Nueva
 *    discusión" sería ruido.
 *  - `/settings/*`: este componente NO se monta ahí porque vive en
 *    `(gated)/layout.tsx`, settings está fuera del gated.
 *  - PlaceClosedView: `(gated)/layout.tsx` retorna PlaceClosedView
 *    antes de mountar este componente.
 *
 * Items del menú (MVP, hardcoded):
 *  - "Nueva discusión" → `/conversations/new`.
 *  - "Proponer evento" → `/events/new`.
 *
 * Mismo set en las 3 zonas (no zona-aware en MVP — costo cognitivo
 * de "el menú cambia según donde estoy" supera el beneficio para una
 * app de 150 members). Futuro: si producto pide priorizar acción de
 * la zona actual, agregar reorder/highlight (no breaking).
 *
 * Boundary: NO importa de `discussions` ni `events` — los paths son
 * strings literales. Cero violación de aislamiento.
 *
 * Ver `docs/features/shell/spec.md` § 17 + ADR
 * `docs/decisions/2026-04-26-zone-fab.md`.
 */
const ZONE_PATHS = ZONES.map((z) => z.path)

export function ZoneFab(): React.ReactNode {
  const pathname = usePathname()
  if (!isZoneRootPath(pathname, ZONE_PATHS)) return null

  return (
    <FAB icon={<Sparkles size={20} aria-hidden="true" />} triggerLabel="Acciones">
      <DropdownMenuItem asChild>
        <Link href="/conversations/new">Nueva discusión</Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link href="/events/new">Proponer evento</Link>
      </DropdownMenuItem>
    </FAB>
  )
}
