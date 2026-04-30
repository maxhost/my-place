/**
 * Empty state de la sub-page de categoría (`/library/[categorySlug]`).
 *
 * Dos casos:
 *  - **Categoría vacía** (`hasFilter=false`): "Esta categoría
 *    todavía no tiene recursos."
 *  - **Filter activo sin matches** (`hasFilter=true`): "Sin
 *    resultados con este filtro." + sugerencia de limpiar.
 *
 * Sin CTA — uploads diferidos. Cuando R.5.X sume uploads, evaluar
 * agregar "Subir el primero" al caso vacía-categoría.
 *
 * Server Component puro.
 *
 * Ver `docs/features/library/spec.md`.
 */
type Props = {
  hasFilter?: boolean
}

export function EmptyDocList({ hasFilter = false }: Props): React.ReactNode {
  if (hasFilter) {
    return (
      <div className="mx-3 flex flex-col items-center gap-2 rounded-[18px] border-[0.5px] border-border bg-surface px-6 py-8 text-center">
        <span aria-hidden="true" className="text-4xl leading-none">
          🔎
        </span>
        <h2 className="font-title text-[18px] font-semibold text-text">Sin resultados</h2>
        <p className="max-w-[280px] font-body text-sm text-muted">
          Probá con otro filtro o quitá los filtros para ver todos los recursos.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-3 flex flex-col items-center gap-2 rounded-[18px] border-[0.5px] border-border bg-surface px-6 py-10 text-center">
      <span aria-hidden="true" className="text-4xl leading-none">
        🪶
      </span>
      <h2 className="font-title text-[18px] font-semibold text-text">
        Todavía no hay recursos en esta categoría
      </h2>
      <p className="max-w-[280px] font-body text-sm text-muted">
        Cuando alguien suba un documento, lo vas a ver acá.
      </p>
    </div>
  )
}
