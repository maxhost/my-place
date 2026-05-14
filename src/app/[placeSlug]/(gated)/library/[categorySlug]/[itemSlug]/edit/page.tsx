import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import {
  canEditItem,
  LibraryItemHeaderBar,
  updateLibraryItemAction,
} from '@/features/library/public'
import {
  findItemBySlug,
  findLibraryCategoryBySlug,
  resolveLibraryViewer,
} from '@/features/library/public.server'
import { listCategoryItemsForPrereqLookup } from '@/features/library/courses/public.server'
import { LibraryItemComposerForm } from '@/features/discussions/composers/public'
import type { LexicalDocument } from '@/features/rich-text/public'
import { getEditorConfigForPlace } from '@/features/editor-config/public.server'

type Props = {
  params: Promise<{ placeSlug: string; categorySlug: string; itemSlug: string }>
}

/**
 * Edit page del item (R.7.9). Gate: viewer es admin/owner del place
 * o author del item. Si falla → notFound().
 *
 * F.4: monta `<LibraryItemComposerForm mode="edit">` con el body Lexical
 * + título + coverUrl. El submit redirect a la URL canónica de detail.
 *
 * **Courses (W2 wiring 2026-05-14, refactor 2026-05-14)**: si la categoría
 * es `kind: COURSE`, el composer recibe `prereqMode` con las opciones de
 * items siblings. El composer renderea `<PrereqToggleSelector>` adentro
 * (toggle "¿depende de otra?" + select). Submit del form también dispara
 * `setItemPrereqAction` si la selección cambió. Antes el `<PrereqSelector>`
 * vivía aparte y persistía onChange — patrón reemplazado para UX
 * consistente entre CREATE y EDIT.
 */
export default async function EditLibraryItemPage({ params }: Props) {
  const { placeSlug, categorySlug, itemSlug } = await params

  const place = await loadPlaceBySlug(placeSlug)
  if (!place) notFound()

  const [item, vctx, category] = await Promise.all([
    findItemBySlug(place.id, categorySlug, itemSlug, { includeArchived: true }),
    resolveLibraryViewer({ placeSlug }),
    findLibraryCategoryBySlug(place.id, categorySlug),
  ])
  if (!item || !category) notFound()

  const canEdit = canEditItem({ authorUserId: item.authorUserId }, vctx.viewer)
  if (!canEdit) notFound()

  const enabledEmbeds = await getEditorConfigForPlace(place.id)

  // Solo cargar opciones de prereq cuando la categoría es COURSE — para
  // GENERAL la query es ruido innecesario. Filtra el item actual (un item
  // no puede ser su propio prereq).
  const prereqOptions =
    category.kind === 'COURSE'
      ? (await listCategoryItemsForPrereqLookup(category.id, place.id)).filter(
          (opt) => opt.id !== item.id,
        )
      : []

  return (
    <div>
      <LibraryItemHeaderBar
        categorySlug={item.categorySlug}
        backHref={`/library/${item.categorySlug}/${item.postSlug}`}
      />
      <div className="px-3 py-6">
        <header className="mb-5 flex items-center gap-3">
          <span aria-hidden className="text-3xl leading-none">
            {item.categoryEmoji}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm text-muted">Biblioteca · {item.categoryTitle}</p>
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
          enabledEmbeds={enabledEmbeds}
          {...(category.kind === 'COURSE'
            ? {
                prereqMode: {
                  options: prereqOptions.map((opt) => ({ id: opt.id, title: opt.title })),
                  initialPrereqId: item.prereqItemId,
                },
              }
            : {})}
        />
      </div>
    </div>
  )
}
