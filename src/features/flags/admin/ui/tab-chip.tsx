import Link from 'next/link'

type Props = {
  href: string
  active: boolean
  label: string
}

/**
 * Chip tab para `FlagsAdminPanel` (Pendientes / Resueltos).
 *
 * Duplicado del `<TabChip>` de `features/members/admin/` por decisión
 * deliberada (regla CLAUDE.md "evitar abstracciones prematuras"). Extraer
 * a `shared/ui/` cuando emerja un 3er consumer del primitive.
 *
 * Usa `<Link>` de next/link para nav client-side (RSC payload diff del
 * segment — no full page reload). `scroll={false}` para no resetear scroll
 * al cambiar tab.
 */
export function TabChip({ href, active, label }: Props): React.ReactNode {
  const base =
    'inline-flex min-h-11 items-center rounded-full border px-3 text-sm transition-colors'
  const activeClass = 'border-neutral-900 bg-neutral-900 text-white'
  const inactiveClass = 'border-neutral-300 text-neutral-700 hover:bg-neutral-50'
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'page' : undefined}
      className={`${base} ${active ? activeClass : inactiveClass}`}
    >
      {label}
    </Link>
  )
}
