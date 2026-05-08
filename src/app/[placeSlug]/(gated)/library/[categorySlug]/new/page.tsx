import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { canCreateInCategory, createLibraryItemAction } from '@/features/library/public'
import {
  findLibraryCategoryBySlug,
  listCategoryContributorUserIds,
  resolveLibraryViewer,
} from '@/features/library/public.server'
import { LibraryItemComposerForm } from '@/features/discussions/composers/public'
import { getEditorConfigForPlace } from '@/features/editor-config/public.server'

type Props = {
  params: Promise<{ placeSlug: string; categorySlug: string }>
}

/**
 * Compositor de un nuevo item dentro de una categoría (R.7.8).
 *
 * Server Component que valida:
 *  1. Place existe y no está archivado.
 *  2. Categoría existe, pertenece al place y no está archivada.
 *  3. Viewer es member activo del place.
 *  4. `canCreateInCategory` (admin | designated en su cat | members_open).
 *
 * Si alguno falla → `notFound()`. Si pasa todo, renderiza el composer
 * de Lexical (F.4).
 *
 * Ver `docs/features/library/spec.md` § 14.8 + `docs/features/rich-text/spec.md`.
 */
export default async function NewLibraryItemPage({ params }: Props) {
  const { placeSlug, categorySlug } = await params

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) notFound()

  const { viewer } = await resolveLibraryViewer({ placeSlug })

  const category = await findLibraryCategoryBySlug(place.id, categorySlug)
  if (!category) notFound()

  const designatedUserIds =
    category.contributionPolicy === 'DESIGNATED'
      ? await listCategoryContributorUserIds(category.id)
      : []

  const canCreate = canCreateInCategory(
    {
      contributionPolicy: category.contributionPolicy,
      designatedUserIds,
    },
    viewer,
  )
  if (!canCreate) notFound()

  const enabledEmbeds = await getEditorConfigForPlace(place.id)

  return (
    <div className="px-3 py-6">
      <header className="mb-5 flex items-center gap-3">
        <span aria-hidden className="text-3xl leading-none">
          {category.emoji}
        </span>
        <div>
          <p className="text-sm text-muted">Biblioteca · {category.title}</p>
          <h1 className="font-title text-[26px] font-bold tracking-[-0.6px] text-text">
            Nuevo recurso
          </h1>
        </div>
      </header>

      <LibraryItemComposerForm
        mode={{
          kind: 'create',
          placeId: place.id,
          categoryId: category.id,
          categorySlug: category.slug,
          onCreate: createLibraryItemAction,
        }}
        enabledEmbeds={enabledEmbeds}
      />
    </div>
  )
}
