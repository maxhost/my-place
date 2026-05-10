'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BookOpen,
  Clock,
  Flag,
  KeyRound,
  Menu,
  PenLine,
  Shield,
  SlidersHorizontal,
  Tag,
  Users,
} from 'lucide-react'
import { FAB } from '@/shared/ui/fab'
import { DropdownMenuItem } from '@/shared/ui/dropdown-menu'
import {
  type SettingsSectionSlug,
  deriveActiveSettingsSection,
  deriveVisibleSettingsSections,
} from '../domain/settings-sections'

/**
 * FAB de navegación entre sub-pages de settings — único affordance para
 * que el admin se mueva entre `General · Horarios · Biblioteca · Miembros
 * · Reportes` sin volver al inbox ni recordar URLs.
 *
 * Visibilidad: SOLO se monta desde `app/[placeSlug]/settings/layout.tsx`
 * (después del gate admin/owner). Este componente NO es admin-aware ni
 * pathname-aware para visibilidad — asume que el caller ya gateó.
 *
 * NO contradice el spec del shell (§ 1) que rechaza hamburger como
 * **navegación primaria del place**: acá el burger es **sub-navegación
 * dentro de settings**, rol distinto. La nav primaria sigue siendo dots
 * de zona, sin cambios.
 *
 * Coexistencia con `<ZoneFab>`: cero conflicto. `<ZoneFab>` no se monta
 * en `/settings/*` (gate interno por `isZoneRootPath` + library category
 * subpage). Verificado en `zone-fab.tsx` línea 70.
 *
 * Active state: `usePathname()` + `deriveActiveSettingsSection` →
 * `aria-current="page"` + `bg-soft`. El user ve qué sección está mirando
 * incluso después de abrir el menú.
 *
 * Ver `docs/features/shell/spec.md` § "Settings affordances".
 */

const SECTION_ICON: Record<SettingsSectionSlug, React.ComponentType<{ size?: number }>> = {
  '': SlidersHorizontal,
  hours: Clock,
  library: BookOpen,
  access: KeyRound,
  members: Users,
  flags: Flag,
  groups: Shield,
  tiers: Tag,
  editor: PenLine,
}

type Props = {
  /**
   * Si el viewer es owner del place. Filtra items con `requiredRole: 'owner'`
   * (ej: "Tiers"). Default `false` para retrocompatibilidad — callers que
   * todavía no pasan la prop ven el subset admin-only.
   */
  isOwner?: boolean
}

export function SettingsNavFab({ isOwner = false }: Props = {}): React.ReactNode {
  const pathname = usePathname()
  const activeSlug = deriveActiveSettingsSection(pathname ?? '')
  const visibleSections = deriveVisibleSettingsSections({ isOwner })

  return (
    <FAB icon={<Menu size={20} aria-hidden="true" />} triggerLabel="Navegación de settings">
      {visibleSections.map((section) => {
        const href = section.slug === '' ? '/settings' : `/settings/${section.slug}`
        const isActive = activeSlug === section.slug
        const Icon = SECTION_ICON[section.slug]
        return (
          <DropdownMenuItem key={section.slug} asChild>
            <Link
              href={href}
              aria-current={isActive ? 'page' : undefined}
              className={
                isActive ? 'flex items-center gap-2 bg-soft font-medium' : 'flex items-center gap-2'
              }
            >
              <Icon size={16} aria-hidden="true" />
              <span>{section.label}</span>
            </Link>
          </DropdownMenuItem>
        )
      })}
    </FAB>
  )
}
