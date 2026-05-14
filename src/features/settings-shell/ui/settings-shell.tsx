import { Sidebar } from '@/shared/ui/sidebar/sidebar'
import { buildSettingsShellSections } from '../domain/sections'
import { SettingsCommandPalette } from './settings-command-palette'
import { SettingsUsageTracker } from './settings-usage-tracker'

/**
 * Composer del shell de settings desktop. Server Component que envuelve
 * el content area de `/settings/*` con el sidebar de navegación 240px
 * a la izquierda (desktop) y deja el content area con max-width centrado.
 *
 * Mobile: el sidebar está oculto via CSS (`hidden md:flex`); el FAB del
 * shell sub-slice (`<SettingsNavFab>`) cubre la navegación mobile —
 * coexisten por viewport, no se reemplazan en JS.
 *
 * `currentPath`: prop opcional. En producción NO se pasa — el sidebar y
 * el tracker resuelven el pathname client-side vía `usePathname()` (única
 * forma de que el active state se actualice en client navigation, ya que
 * Next preserva el layout entre rutas hermanas y el header server-rendered
 * queda stale). La prop se mantiene como override para tests.
 *
 * Ver `docs/features/settings-shell/spec.md` § "Composer `<SettingsShell>`".
 */

type Props = {
  children: React.ReactNode
  /** Si el viewer es owner — para filtrar items owner-only del sidebar. */
  isOwner: boolean
  /** Override opcional del active path (tests). En prod se omite. */
  currentPath?: string
}

export function SettingsShell({ children, isOwner, currentPath }: Props): React.ReactNode {
  const sections = buildSettingsShellSections({ isOwner })

  // Content area: solo flex-1 (toma el resto del grid). **NO aplica padding
  // ni max-width propios.** Cada sub-page maneja:
  //  - Su padding interno (canonical: `space-y-6 px-3 py-6 md:px-4 md:py-8`
  //    según ux-patterns.md).
  //  - Su max-width: forms típicos usan `max-w-screen-md mx-auto`; pages
  //    master-detail (groups, members) usan full width para acomodar el
  //    grid lista 360px + detail.
  //
  // Si el shell impusiera max-width, las master-detail pages quedarían
  // atrapadas en 768px y el detail pane sería ~408px (insuficiente).
  return (
    <div className="md:flex md:gap-6">
      <SettingsUsageTracker {...(currentPath !== undefined ? { currentPath } : {})} />
      <SettingsCommandPalette sections={sections} />
      <Sidebar
        items={sections}
        {...(currentPath !== undefined ? { currentPath } : {})}
        ariaLabel="Configuración del place"
        className="hidden md:block"
      />
      <div className="w-full flex-1">{children}</div>
    </div>
  )
}
