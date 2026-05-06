import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'

export const metadata: Metadata = {
  title: 'Nueva conversación',
}

type Props = {
  params: Promise<{ placeSlug: string }>
}

/**
 * stub F.1: el composer Lexical de posts se reintroduce en F.4. Mientras tanto
 * la página muestra un placeholder y queda navegable.
 */
export default async function NewOrEditPostPage({ params }: Props) {
  const { placeSlug } = await params
  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) notFound()

  return (
    <div className="space-y-6 p-4 md:p-8">
      <header>
        <h1 className="font-serif text-2xl italic text-text">Nueva conversación</h1>
        <p className="mt-1 text-sm text-muted">
          Sin apuro. Escribí y publicá cuando tenga sentido.
        </p>
      </header>
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        Editor temporalmente deshabilitado durante migración a Lexical (F.1). Se restaura en F.4.
      </div>
    </div>
  )
}
