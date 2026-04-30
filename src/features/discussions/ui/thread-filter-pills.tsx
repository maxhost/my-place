'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { POST_LIST_FILTERS, parsePostListFilter, type PostListFilter } from '../domain/filter'

/**
 * Filter pills para la lista de threads (R.6 + follow-up F.2).
 *
 * 3 opciones funcionales: `Todos`, `Sin respuesta`, `En los que
 * participo`. El estado vive en URL query param `?filter=`.
 *
 * Click en pill → `router.replace` con el query param actualizado.
 * `replace` (no `push`) evita pollutar el history: el filter cambia
 * el view de la misma "página"; browser back debería salir a la
 * zona anterior, no a otro filter.
 *
 * El default `'all'` no se persiste en la URL — al volver a
 * `Todos`, el `?filter=` se borra para tener URLs limpias en el
 * caso por defecto.
 *
 * Server lee el mismo query param via `searchParams` y aplica el
 * where dinámico en `listPostsByPlace`. SSR funcional; refresh
 * preserva el filter; deep links son compartibles.
 *
 * Ver `docs/features/discussions/spec.md` § 21.4 + ADR
 * `docs/decisions/2026-04-26-threads-layout-redesign.md` (anotación
 * original del follow-up).
 */
const PILLS: ReadonlyArray<{ value: PostListFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'unanswered', label: 'Sin respuesta' },
  { value: 'participating', label: 'En los que participo' },
]

export function ThreadFilterPills(): React.ReactNode {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const active = parsePostListFilter(searchParams.get('filter'))

  const handleClick = (value: PostListFilter) => {
    if (value === active) return
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') {
      params.delete('filter')
    } else {
      params.set('filter', value)
    }
    const qs = params.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
  }

  return (
    <nav
      aria-label="Filtrar discusiones"
      role="tablist"
      className="flex gap-1.5 overflow-x-auto px-3 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {PILLS.map((pill) => {
        const isActive = pill.value === active
        return (
          <button
            key={pill.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => handleClick(pill.value)}
            className={[
              'shrink-0 rounded-full px-[14px] py-2 font-body text-[13px] font-medium motion-safe:transition-colors',
              isActive
                ? 'bg-text text-bg'
                : 'border-[0.5px] border-border bg-transparent text-muted hover:bg-soft',
            ].join(' ')}
          >
            {pill.label}
          </button>
        )
      })}
    </nav>
  )
}

// Re-export para tests + sanity check de la lista canónica.
export { POST_LIST_FILTERS }
