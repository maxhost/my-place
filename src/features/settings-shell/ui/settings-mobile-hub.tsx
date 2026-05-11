import Link from 'next/link'
import { buildSettingsShellSections } from '../domain/sections'

/**
 * Vista del root `/settings` en mobile (y como fallback desktop hasta
 * que exista el dashboard real). Renderiza un grid de cards con cada
 * section, agrupadas. Sin sidebar (el FAB cubre la navegación mobile).
 *
 * Texto placeholder al inicio anota que el dashboard real vendrá en una
 * sesión futura — el `/settings` root es transitorio.
 *
 * Ver `docs/features/settings-shell/spec.md` § "Vista mobile root".
 */

type Props = {
  isOwner: boolean
}

export function SettingsMobileHub({ isOwner }: Props): React.ReactNode {
  const sections = buildSettingsShellSections({ isOwner })

  return (
    <div className="mx-auto max-w-screen-md px-3 py-6 md:px-8 md:py-10">
      <header className="mb-6">
        <h1 className="font-serif text-2xl italic md:text-3xl">Configuración</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Pronto vivirá acá el dashboard del place. Mientras tanto, elegí una sección.
        </p>
      </header>
      <div className="space-y-6">
        {sections.map((group) => (
          <section key={group.id} aria-labelledby={`hub-group-${group.id}`}>
            {group.label ? (
              <h2
                id={`hub-group-${group.id}`}
                className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-neutral-500"
              >
                {group.label}
              </h2>
            ) : null}
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex min-h-[56px] items-center gap-3 rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                  >
                    {item.icon ? (
                      <span className="shrink-0 text-neutral-500" aria-hidden>
                        {item.icon}
                      </span>
                    ) : null}
                    <span>{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
