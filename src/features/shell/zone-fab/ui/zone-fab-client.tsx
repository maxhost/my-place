'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { FAB } from '@/shared/ui/fab'
import { DropdownMenuItem } from '@/shared/ui/dropdown-menu'
import { ZONES, isZoneRootPath } from '@/features/shell/zone-navigation/public'

/**
 * Componente cliente del FAB cross-zona — concentra toda la lógica de
 * pathname + visibilidad + items del menú. Recibe `canCreateLibraryResource`
 * ya resuelto desde el server: el wrapper `<ZoneFab>` lo computa lazy
 * vía Suspense para no bloquear el shell paint del layout (gated).
 *
 * Visibilidad (R.2.6):
 *  - Solo zonas root (`/`, `/conversations`, `/events`, `/library`)
 *    vía `isZoneRootPath` reusado de R.2.5 (mismo gate del swiper).
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
 *  - "Nuevo recurso" → `/library` (R.7.X follow-up). El user
 *    elige categoría desde la zona biblioteca y ahí crea via
 *    "Crear el primero" (empty state) o navegando a la categoría.
 *    Pickr cross-categoría como sub-modal queda diferido.
 *
 * Mismo set en las 4 zonas (no zona-aware en MVP — costo cognitivo
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

type Props = {
  /**
   * Cuando es `false`, el item "Nuevo recurso" se oculta del menú
   * porque el viewer no tiene categorías elegibles (sin categorías
   * en el place, o ninguna donde su rol pueda crear). Mostrar el
   * item igual sería dead-end: el form en `/library/new` mostraría
   * "no hay categorías disponibles".
   *
   * El wrapper Server `<ZoneFab>` resuelve esto via
   * `canCreateInAnyCategoryForViewer` y lo pasa acá.
   */
  canCreateLibraryResource: boolean
}

export function ZoneFabClient({ canCreateLibraryResource }: Props): React.ReactNode {
  const pathname = usePathname()
  // El FAB se muestra en zonas root + sub-page de categoría library.
  // En `/library/[cat]` el item "Nuevo recurso" linkea directo a
  // `/library/[cat]/new` (sin selector de categoría). En zonas root
  // linkea a `/library/new` (con selector). Excepción a la regla
  // "solo zonas root" de R.2.6 — necesaria para que el flow "estoy
  // adentro de Recetas y quiero subir algo nuevo a Recetas" sea 1
  // tap sin volver a /library.
  if (!isZoneRootPath(pathname, ZONE_PATHS) && !isLibraryCategorySubpage(pathname)) {
    return null
  }

  const newResourceHref = computeNewResourceHref(pathname)

  return (
    <FAB icon={<Sparkles size={20} aria-hidden="true" />} triggerLabel="Acciones">
      <DropdownMenuItem asChild>
        <Link href="/conversations/new">Nueva discusión</Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link href="/events/new">Proponer evento</Link>
      </DropdownMenuItem>
      {canCreateLibraryResource ? (
        <DropdownMenuItem asChild>
          <Link href={newResourceHref}>Nuevo recurso</Link>
        </DropdownMenuItem>
      ) : null}
    </FAB>
  )
}

/**
 * `/library/<slug>` (sub-page de categoría) — pero NO sub-paths más
 * profundos (`/library/<slug>/<item>` o `/library/<slug>/new`).
 */
function isLibraryCategorySubpage(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  return /^\/library\/[^/]+$/.test(normalized)
}

/**
 * Resuelve la URL del item "Nuevo recurso" del FAB según el
 * pathname actual:
 *  - `/library/[categorySlug]` → `/library/[categorySlug]/new`
 *    (form con categoría fija).
 *  - cualquier otro path → `/library/new` (form con selector).
 */
function computeNewResourceHref(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  const match = normalized.match(/^\/library\/([^/]+)$/)
  if (match) return `/library/${match[1]}/new`
  return '/library/new'
}
