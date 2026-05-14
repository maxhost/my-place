import Link from 'next/link'

type Props = {
  itemsInPage: number
  nextHref: string | null
}

/**
 * Paginación cursor-based para `<FlagsAdminPanel>`. Sin `Anterior` en V1
 * (decisión documentada en `docs/plans/2026-05-14-redesign-settings-flags.md`
 * § Decisiones cerradas) — el backend usa keyset cursor adelante-solo, no
 * tenemos prev-cursor sin extender la query.
 *
 * Sin `totalCount` (la query no lo devuelve; sumarlo requiere round-trip
 * extra). Mostramos sólo el count de la page actual + Next link.
 *
 * Si `itemsInPage === 0` y `nextHref === null`, NO se renderiza nada (la
 * page padre maneja el empty state).
 */
export function FlagsPagination({ itemsInPage, nextHref }: Props): React.ReactNode {
  if (itemsInPage === 0 && !nextHref) return null

  return (
    <nav
      aria-label="Paginación"
      className="flex items-center justify-between gap-3 pt-2 text-sm text-neutral-600"
    >
      <span aria-live="polite">
        {itemsInPage} {itemsInPage === 1 ? 'reporte en esta página' : 'reportes en esta página'}
      </span>
      {nextHref ? (
        <Link
          href={nextHref}
          scroll={false}
          aria-label="Página siguiente"
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-300 px-3 text-sm hover:bg-neutral-50"
        >
          Siguientes →
        </Link>
      ) : null}
    </nav>
  )
}
