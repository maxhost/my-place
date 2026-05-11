import { Sidebar } from '@/shared/ui/sidebar/sidebar'
import { buildSettingsShellSections } from '../domain/sections'

/**
 * Composer del shell de settings desktop. Server Component que envuelve
 * el content area de `/settings/*` con el sidebar de navegación 240px
 * a la izquierda (desktop) y deja el content area con max-width centrado.
 *
 * Mobile: el sidebar está oculto via CSS (`hidden md:flex`); el FAB del
 * shell sub-slice (`<SettingsNavFab>`) cubre la navegación mobile —
 * coexisten por viewport, no se reemplazan en JS.
 *
 * Ver `docs/features/settings-shell/spec.md` § "Composer `<SettingsShell>`".
 */

type Props = {
  children: React.ReactNode
  /**
   * Pathname server-rendered del request (vía `headers()` o segments).
   * En multi-subdomain place, viene como `/settings/hours` (sin slug — el
   * slug está en el host).
   */
  currentPath: string
  /** Si el viewer es owner — para filtrar items owner-only del sidebar. */
  isOwner: boolean
}

export function SettingsShell({ children, currentPath, isOwner }: Props): React.ReactNode {
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
      <Sidebar
        items={sections}
        currentPath={currentPath}
        ariaLabel="Configuración del place"
        className="hidden md:flex"
      />
      <div className="w-full flex-1">{children}</div>
    </div>
  )
}
