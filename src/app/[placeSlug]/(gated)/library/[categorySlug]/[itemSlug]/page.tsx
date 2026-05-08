import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { LibraryItemHeaderBar } from '@/features/library/public'
import { findItemBySlug } from '@/features/library/public.server'
import { CommentsSection, CommentsSkeleton } from './_comments-section'
import { LibraryItemContent } from './_library-item-content'
import { LibraryItemHeaderActions } from './_library-item-header-actions'
import { LibraryItemContentSkeleton } from './_skeletons'

type Props = {
  params: Promise<{ placeSlug: string; categorySlug: string; itemSlug: string }>
}

/**
 * Detalle del item de biblioteca (R.7.9 layout). URL canónica:
 * `/library/[categorySlug]/[itemSlug]` — el item ES el thread documento
 * (vive en Post; LibraryItem no tiene slug propio).
 *
 * **Patrón canónico de streaming agresivo del shell** — top-level await
 * SÓLO para el check de existencia (loadPlace + findItemBySlug cacheados).
 * Todo el resto streama:
 *
 *  - `<LibraryItemHeaderBar>` pinta inmediato con back button a la categoría.
 *  - `<LibraryItemContent>` (Suspense) → fetch viewer + archived check +
 *    body TipTap. Resuelve en ~700ms cold; mientras tanto el skeleton del
 *    body matched-dimension.
 *  - `<CommentsSection>` (Suspense) → fetch comments + reactions + readers.
 *    Resuelve en ~1s cold; skeleton aparte.
 *  - `<LibraryItemHeaderActions>` (Suspense, fallback null) → admin/author
 *    kebab, aparece in-place cuando viewer + permisos resuelven.
 *
 * Cada Suspense child fetchea sus dependencies independientemente.
 * `React.cache` per-request dedupea queries compartidas (viewer) entre
 * los 3 children — 1 query física por request aunque la pidan todos.
 *
 * Archivado (R.7.9): items archivados sólo son visibles para admin/author.
 * El check vive en `<LibraryItemContent>` (Suspense child) — caso raro de
 * moderación, flicker post-skeleton aceptable.
 *
 * Ver `docs/architecture.md` § "Streaming agresivo del shell" y
 * `docs/features/library/spec.md` § 14.9.
 */
export default async function LibraryItemDetailPage({ params }: Props) {
  const { placeSlug, categorySlug, itemSlug } = await params
  const place = await loadPlaceBySlug(placeSlug)
  if (!place) notFound()

  const item = await findItemBySlug(place.id, categorySlug, itemSlug, { includeArchived: true })
  if (!item) notFound()

  return (
    <div className="pb-32">
      <LibraryItemHeaderBar
        categorySlug={item.categorySlug}
        rightSlot={
          <Suspense fallback={null}>
            <LibraryItemHeaderActions item={item} placeSlug={placeSlug} />
          </Suspense>
        }
      />
      <Suspense fallback={<LibraryItemContentSkeleton />}>
        <LibraryItemContent item={item} placeId={place.id} placeSlug={placeSlug} />
      </Suspense>
      <Suspense fallback={<CommentsSkeleton />}>
        <CommentsSection placeId={place.id} placeSlug={placeSlug} postId={item.postId} />
      </Suspense>
    </div>
  )
}
