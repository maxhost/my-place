'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { z } from 'zod'
import type { DocType } from '../domain/types'

/**
 * Filter pills por tipo de doc en la sub-page de categoría.
 *
 * Patrón idéntico a `<ThreadFilterPills>` del slice discussions:
 * estado en URL query param `?type=`, `useSearchParams` para leer,
 * `router.replace` para escribir (sin pollutar history). Default
 * `all` se persiste como URL limpia (sin `?type=`).
 *
 * **Pills dinámicos** — solo se muestran los types presentes en
 * `available` (calculado por la page caller a partir de `docs[]`).
 * Si la categoría tiene 0 docs, `available` es vacío y el componente
 * retorna null (no se renderiza UI).
 *
 * "Todos" siempre presente cuando hay al menos 1 type disponible.
 *
 * Ver `docs/features/library/spec.md`.
 */

const POST_LIST_DOC_TYPES = ['pdf', 'link', 'image', 'doc', 'sheet'] as const

const TYPE_FILTER_SCHEMA = z.enum(['all', ...POST_LIST_DOC_TYPES]).catch('all')

type TypeFilter = 'all' | DocType

const LABEL_BY_TYPE: Record<TypeFilter, string> = {
  all: 'Todos',
  pdf: 'PDF',
  link: 'Links',
  image: 'Imágenes',
  doc: 'Docs',
  sheet: 'Hojas',
}

type Props = {
  /** Tipos presentes en los docs de esta categoría. Si vacío, el
   *  componente no renderiza nada (no hay docs de qué filtrar). */
  available: ReadonlyArray<DocType>
}

export function TypeFilterPills({ available }: Props): React.ReactNode {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()

  if (available.length === 0) return null

  const active = TYPE_FILTER_SCHEMA.parse(searchParams.get('type') ?? 'all')
  const pills: TypeFilter[] = ['all', ...available]

  const handleClick = (value: TypeFilter) => {
    if (value === active) return
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') {
      params.delete('type')
    } else {
      params.set('type', value)
    }
    const qs = params.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
  }

  return (
    <nav
      aria-label="Filtrar por tipo"
      role="tablist"
      className="flex gap-1.5 overflow-x-auto px-3 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {pills.map((pill) => {
        const isActive = pill === active
        return (
          <button
            key={pill}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => handleClick(pill)}
            className={[
              'shrink-0 rounded-full px-[14px] py-2 font-body text-[13px] font-medium motion-safe:transition-colors',
              isActive
                ? 'bg-text text-bg'
                : 'border-[0.5px] border-border bg-transparent text-muted hover:bg-soft',
            ].join(' ')}
          >
            {LABEL_BY_TYPE[pill]}
          </button>
        )
      })}
    </nav>
  )
}

export { TYPE_FILTER_SCHEMA }
