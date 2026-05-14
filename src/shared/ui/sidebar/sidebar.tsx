'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { SidebarSections } from './sidebar.types'

/**
 * Primitive `<Sidebar>` agnóstico al dominio. Sidebar vertical de navegación
 * con grouping, active state via `aria-current="page"` y accessibility
 * built-in (`<nav aria-label>`, focus-visible, keyboard nav nativo).
 *
 * Client Component — usa `usePathname()` para derivar el item activo. Sin
 * esto, layouts compartidos (ej. `/settings/*`) congelan el active state
 * porque Next no re-ejecuta el layout entre rutas hermanas: el header
 * `x-pathname` se evalúa solo en la primera request y queda stale en
 * client navigation.
 *
 * `currentPath` prop opcional: si está, gana sobre `usePathname()` —
 * útil para tests (sin Router context) o para forzar un estado en
 * stories/storybook. En producción, se omite y el hook resuelve solo.
 *
 * Defaults chrome-neutral según `docs/ux-patterns.md` § color palette
 * (raw Tailwind neutrals, no CSS vars de brand). Para tematizar al brand
 * del place en gated zone, pasar `className` con overrides.
 *
 * Ver `docs/features/settings-shell/spec.md` § "API del primitive `<Sidebar>`".
 */

type Props = {
  items: SidebarSections
  /** Override opcional del active state. Sin él, usa `usePathname()`. */
  currentPath?: string
  ariaLabel: string
  className?: string
}

export function Sidebar({ items, currentPath, ariaLabel, className }: Props): React.ReactNode {
  const pathname = usePathname()
  const activePath = currentPath ?? pathname ?? ''
  const navClass = `w-60 shrink-0 border-r border-neutral-200 bg-white px-3 py-6${
    className ? ` ${className}` : ''
  }`

  return (
    <nav aria-label={ariaLabel} className={navClass}>
      {items.map((group) => (
        <div key={group.id} className="mb-6 last:mb-0">
          {group.label ? (
            <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
              {group.label}
            </h3>
          ) : null}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const isActive = item.href === activePath
              const linkClass = isActive
                ? 'flex min-h-11 items-center gap-2 rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900'
                : 'flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900'
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={linkClass}
                    {...(isActive ? { 'aria-current': 'page' } : {})}
                  >
                    {item.icon ? (
                      <span className="shrink-0" aria-hidden>
                        {item.icon}
                      </span>
                    ) : null}
                    <span>{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
