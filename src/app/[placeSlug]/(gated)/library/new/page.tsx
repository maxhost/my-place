import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'

type Props = {
  params: Promise<{ placeSlug: string }>
}

/**
 * stub F.1: el LibraryItemForm (TipTap) se reintroduce en F.4 con composer
 * Lexical. Mientras tanto la page muestra un placeholder y queda navegable.
 */
export default async function NewLibraryItemAtRootPage({ params }: Props) {
  const { placeSlug } = await params

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) notFound()

  return (
    <div className="px-3 py-6">
      <header className="mb-5">
        <p className="text-sm text-muted">Biblioteca</p>
        <h1 className="font-title text-[26px] font-bold tracking-[-0.6px] text-text">
          Nuevo recurso
        </h1>
      </header>

      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        Editor temporalmente deshabilitado durante migración a Lexical (F.1). Se restaura en F.4.
      </div>
    </div>
  )
}
