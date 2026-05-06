import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { canEditItem, updateLibraryItemAction } from '@/features/library/public'
import { findItemBySlug, resolveLibraryViewer } from '@/features/library/public.server'
import { LibraryItemComposerForm } from '@/features/discussions/public'
import type { LexicalDocument } from '@/features/rich-text/public'

type Props = {
  params: Promise<{ placeSlug: string; categorySlug: string; itemSlug: string }>
}

/**
 * Edit page del item (R.7.9). Gate: viewer es admin/owner del place
 * o author del item. Si falla → notFound().
 *
 * F.4: monta `<LibraryItemComposerForm mode="edit">` con el body Lexical
 * + título + coverUrl. El submit redirect a la URL canónica de detail.
 */
export default async function EditLibraryItemPage({ params }: Props) {
  const { placeSlug, categorySlug, itemSlug } = await params

  const place = await loadPlaceBySlug(placeSlug)
  if (!place) notFound()

  const [item, vctx] = await Promise.all([
    findItemBySlug(place.id, categorySlug, itemSlug, { includeArchived: true }),
    resolveLibraryViewer({ placeSlug }),
  ])
  if (!item) notFound()

  const canEdit = canEditItem({ authorUserId: item.authorUserId }, vctx.viewer)
  if (!canEdit) notFound()

  return (
    <div className="px-3 py-6">
      <header className="mb-5 flex items-center gap-3">
        <span aria-hidden className="text-3xl leading-none">
          {item.categoryEmoji}
        </span>
        <div>
          <p className="text-sm text-muted">Biblioteca · {item.categoryTitle}</p>
          <h1 className="font-title text-[26px] font-bold tracking-[-0.6px] text-text">
            Editar recurso
          </h1>
        </div>
      </header>

      <LibraryItemComposerForm
        mode={{
          kind: 'edit',
          placeId: place.id,
          itemId: item.id,
          expectedVersion: item.postVersion,
          categorySlug: item.categorySlug,
          initialTitle: item.title,
          initialDocument: item.body as LexicalDocument,
          initialCoverUrl: item.coverUrl,
          onUpdate: updateLibraryItemAction,
        }}
        enabledEmbeds={{
          youtube: true,
          spotify: true,
          applePodcasts: true,
          ivoox: true,
        }}
      />
    </div>
  )
}
