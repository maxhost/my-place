import Link from 'next/link'
import type { ContentTargetKind } from '@/features/flags/public'

export type TargetTypeFilterValue = ContentTargetKind | 'all'

type Props = {
  active: TargetTypeFilterValue
  hrefs: Record<TargetTypeFilterValue, string>
}

/**
 * Filter chips horizontales debajo de los tabs Pendientes/Resueltos del
 * `<FlagsAdminPanel>`. Permite al admin filtrar la cola por tipo de
 * contenido reportado (POST / COMMENT / EVENT) o ver todos.
 *
 * URL-based — cada chip es un `<Link>` con href precomputado en el page
 * server (preserva `?tab=`, resetea `?cursor=` porque el cursor anterior
 * no aplica al nuevo conjunto filtrado). `scroll={false}` para no resetear
 * scroll al cambiar filtro.
 *
 * Labels en español + plural ("Posts", "Comentarios", "Eventos") siguiendo
 * la convención de copy del producto.
 */
export function TargetTypeFilter({ active, hrefs }: Props): React.ReactNode {
  const options: Array<{ value: TargetTypeFilterValue; label: string }> = [
    { value: 'all', label: 'Todos' },
    { value: 'POST', label: 'Posts' },
    { value: 'COMMENT', label: 'Comentarios' },
    { value: 'EVENT', label: 'Eventos' },
  ]

  const base = 'inline-flex min-h-9 items-center rounded-full border px-3 text-xs transition-colors'
  const activeClass = 'border-neutral-700 bg-neutral-100 text-neutral-900'
  const inactiveClass = 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'

  return (
    <div
      role="radiogroup"
      aria-label="Filtrar por tipo de contenido"
      className="flex flex-wrap items-center gap-1.5"
    >
      {options.map((opt) => {
        const isActive = active === opt.value
        return (
          <Link
            key={opt.value}
            href={hrefs[opt.value]}
            scroll={false}
            role="radio"
            aria-checked={isActive}
            className={`${base} ${isActive ? activeClass : inactiveClass}`}
          >
            {opt.label}
          </Link>
        )
      })}
    </div>
  )
}
