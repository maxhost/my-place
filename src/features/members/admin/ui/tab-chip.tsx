import Link from 'next/link'

type Props = {
  href: string
  active: boolean
  label: string
  count: number | null
}

/**
 * Chip tab para `MembersAdminPanel` (Activos / Invitados).
 *
 * Usa `<Link>` de next/link para navegación **client-side** — Next 15 envía
 * sólo el RSC payload del segment que cambia (`?tab=` flipea entre Activos
 * e Invitados), no re-renderea el shell ni el layout. Sin esto, un `<a>`
 * plano dispararía full page reload, perdiendo el state del orchestrator
 * (sub-sheets latcheados) y haciendo ruido visual.
 *
 * `scroll={false}`: cambiar de tab no debería resetear scroll si el user
 * estaba leyendo abajo. Match con el patrón del search bar.
 */
export function TabChip({ href, active, label, count }: Props): React.ReactNode {
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
      <span>{label}</span>
      {count !== null ? (
        <span
          className={`ml-1.5 inline-block min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] ${
            active ? 'bg-white/15' : 'bg-neutral-100'
          }`}
        >
          {count}
        </span>
      ) : null}
    </Link>
  )
}
