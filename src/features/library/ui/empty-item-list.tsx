import Link from 'next/link'

/**
 * Empty state de la sub-page de categoría (`/library/[categorySlug]`).
 *
 * Tres casos:
 *  - **Filter sin matches** (`hasFilter=true`): "Sin resultados".
 *  - **Categoría vacía + viewer puede crear** (`canCreate=true`):
 *    título + CTA "Crear el primero" linkable a `/library/[cat]/new`.
 *  - **Categoría vacía + viewer NO puede crear**: copy calmo sin CTA
 *    (es el contenido lo trae alguien con permiso, el viewer espera).
 *
 * Server Component puro.
 *
 * Ver `docs/features/library/spec.md` § 6.
 */
type Props = {
  hasFilter?: boolean
  /** Cuando es categoría vacía: muestra CTA si el viewer puede
   *  crear items (admin / designated / members_open según policy). */
  canCreate?: boolean
  /** Slug de la categoría — para construir el link del CTA. */
  categorySlug?: string
}

export function EmptyItemList({
  hasFilter = false,
  canCreate = false,
  categorySlug,
}: Props): React.ReactNode {
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
    <div className="mx-3 flex flex-col items-center gap-3 rounded-[18px] border-[0.5px] border-border bg-surface px-6 py-10 text-center">
      <span aria-hidden="true" className="text-4xl leading-none">
        🪶
      </span>
      <h2 className="font-title text-[18px] font-semibold text-text">
        Todavía no hay recursos en esta categoría
      </h2>
      <p className="max-w-[280px] font-body text-sm text-muted">
        Cuando alguien comparta un recurso, lo vas a ver acá.
      </p>
      {canCreate && categorySlug ? (
        <Link
          href={`/library/${categorySlug}/new`}
          className="mt-2 rounded-md bg-accent px-4 py-2 text-sm text-bg"
        >
          Crear el primero →
        </Link>
      ) : null}
    </div>
  )
}
