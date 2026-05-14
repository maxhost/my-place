type Props = {
  href: string
  active: boolean
  label: string
  count: number | null
}

/**
 * Chip tab para `MembersAdminPanel` (Activos / Invitados).
 *
 * Server-friendly anchor — la navegación es URL-based (`?tab=`), no client
 * state. `count` opcional para mostrar el total del tab activo solamente
 * (mantenemos los otros tabs sin number para no requerir contar también
 * el otro lado en cada request).
 */
export function TabChip({ href, active, label, count }: Props): React.ReactNode {
  const base =
    'inline-flex min-h-11 items-center rounded-full border px-3 text-sm transition-colors'
  const activeClass = 'border-neutral-900 bg-neutral-900 text-white'
  const inactiveClass = 'border-neutral-300 text-neutral-700 hover:bg-neutral-50'
  return (
    <a
      href={href}
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
    </a>
  )
}
