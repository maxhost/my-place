import Link from 'next/link'

/**
 * Empty state de la zona Biblioteca.
 *
 * Cuando no hay categorías en el place, mostramos un placeholder
 * calmo: emoji 📭 + título Fraunces + subtitle muted. Para admins
 * suma un CTA secundario linkable a `/settings/library` para crear
 * la primera categoría — el resto de los miembros ven solo el copy.
 *
 * Sin grito visual, sin badges. Alineado con principios "nada
 * parpadea, nada grita" + "presencia silenciosa".
 *
 * Server Component puro.
 *
 * Ver `docs/features/library/spec.md` § 6.
 */
type Props = {
  /** Cuando true, suma CTA "Crear primera categoría" linkable a
   *  `/settings/library`. Solo el page padre admin lo pasa true. */
  canManageCategories?: boolean
}

export function EmptyLibrary({ canManageCategories = false }: Props = {}): React.ReactNode {
  return (
    <div className="mx-3 flex flex-col items-center gap-3 rounded-[18px] border-[0.5px] border-border bg-surface px-6 py-10 text-center">
      <span aria-hidden="true" className="text-4xl leading-none">
        📭
      </span>
      <h2 className="font-title text-[22px] font-bold text-text">
        Tu comunidad todavía no agregó recursos
      </h2>
      <p className="max-w-[280px] font-body text-sm text-muted">
        Cuando alguien comparta un recurso, lo vas a ver acá organizado por categoría.
      </p>
      {canManageCategories ? (
        <Link
          href="/settings/library"
          className="mt-2 text-sm text-accent underline-offset-2 hover:underline"
        >
          Crear primera categoría →
        </Link>
      ) : null}
    </div>
  )
}
