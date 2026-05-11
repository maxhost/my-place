import type { ReactNode } from 'react'
import { BookOpen, Clock, Flag, KeyRound, PenLine, Shield, Tag, Users } from 'lucide-react'
import {
  deriveVisibleSettingsSections,
  type SettingsSectionSlug,
} from '@/features/shell/settings-nav/public'
import type { SidebarSections } from '@/shared/ui/sidebar/sidebar.types'

/**
 * Catálogo de secciones del sidebar de settings desktop. Reusa la data raw
 * y el filtro de permisos del shell sub-slice (`features/shell/settings-nav/`)
 * — single source of truth de slugs/labels/permissions — y agrega:
 *
 * - **Grouping** (Place / Comunidad / Contenido) — convención visual
 *   sidebar settings (Linear, Stripe, Vercel). El FAB mobile NO necesita
 *   grouping (renderiza flat list en dropdown), por eso el mapping vive acá.
 * - **Icons** de `lucide-react` — reusa los del FAB para coherencia visual
 *   entre desktop y mobile.
 * - **Hrefs SIN prefijo placeSlug** (ej. `/settings/hours`): en multi-subdomain
 *   cada place vive en su propio host (`the-company.place.community`). El
 *   pathname server-side del request es `/settings/hours` (el slug está en el
 *   host, no en el path). `<Link href="/settings/hours">` resuelve correctamente
 *   dentro del subdomain. Patrón consistente con `<SettingsNavFab>` que ya usa
 *   los mismos hrefs sin slug.
 *
 * **Excluye explícitamente** el slug `''` (General) — el `/settings` root
 * es placeholder hub mobile / welcome desktop, NO una sub-page con
 * contenido real (futuro dashboard, fuera de scope).
 *
 * Ver `docs/features/settings-shell/spec.md` § "Data: SETTINGS_SECTIONS".
 */

const ICONS_BY_SLUG: Record<string, ReactNode> = {
  hours: <Clock className="h-4 w-4" />,
  access: <KeyRound className="h-4 w-4" />,
  editor: <PenLine className="h-4 w-4" />,
  members: <Users className="h-4 w-4" />,
  groups: <Shield className="h-4 w-4" />,
  tiers: <Tag className="h-4 w-4" />,
  library: <BookOpen className="h-4 w-4" />,
  flags: <Flag className="h-4 w-4" />,
}

type GroupDefinition = {
  id: string
  label: string
  slugs: SettingsSectionSlug[]
}

/**
 * Orden y agrupación visible en el sidebar. Si una section está acá pero no
 * está en `SETTINGS_SECTIONS` del shell, simplemente no se renderiza (no
 * rompe). Si una section está en el shell pero no acá, NO aparece en el
 * sidebar (override consciente — ej. slug '' / General).
 */
const GROUPS: ReadonlyArray<GroupDefinition> = [
  { id: 'place', label: 'Place', slugs: ['hours', 'access', 'editor'] },
  { id: 'comunidad', label: 'Comunidad', slugs: ['members', 'groups', 'tiers'] },
  { id: 'contenido', label: 'Contenido', slugs: ['library', 'flags'] },
]

/**
 * Construye las sections del sidebar para el viewer actual.
 *
 * - Filtra por `isOwner` via el helper canónico del shell.
 * - Hrefs sin prefijo placeSlug (ver doc del módulo arriba).
 * - Agrupa según `GROUPS`.
 * - Excluye groups completamente vacíos (si el viewer no tiene permisos
 *   para ningún item del group).
 */
export function buildSettingsShellSections(ctx: { isOwner: boolean }): SidebarSections {
  const visible = deriveVisibleSettingsSections({ isOwner: ctx.isOwner })
  const visibleBySlug = new Map(visible.map((s) => [s.slug, s]))

  return GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    items: group.slugs.flatMap((slug) => {
      const section = visibleBySlug.get(slug)
      if (!section) return []
      return [
        {
          href: `/settings/${slug}`,
          label: section.label,
          icon: ICONS_BY_SLUG[slug],
        },
      ]
    }),
  })).filter((group) => group.items.length > 0)
}
