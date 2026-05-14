import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { BackLink } from '@/shared/ui/back-button'
import { createLibraryItemAction } from '@/features/library/public'
import { findLibraryCategoryBySlug, resolveLibraryViewer } from '@/features/library/public.server'
import { canWriteCategory } from '@/features/library/contribution/public'
import { findWriteScope } from '@/features/library/contribution/public.server'
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

  const writeScope = await findWriteScope(category.id)
  if (!writeScope) notFound()
  const canCreate = canWriteCategory(
    {
      writeAccessKind: writeScope.kind,
      groupWriteIds: writeScope.groupIds,
      tierWriteIds: writeScope.tierIds,
      userWriteIds: writeScope.userIds,
    },
    viewer,
  )
  if (!canCreate) notFound()

  const enabledEmbeds = await getEditorConfigForPlace(place.id)

  return (
    <div className="px-3 py-6">
      <header className="mb-5 flex items-center gap-3">
        <BackLink href={`/library/${category.slug}`} label={`Volver a ${category.title}`} />
        <span aria-hidden className="text-3xl leading-none">
          {category.emoji}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm text-muted">Biblioteca · {category.title}</p>
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

      {category.kind === 'COURSE' ? (
        <p className="mt-4 rounded-md border border-border bg-surface p-3 text-xs text-muted">
          Esta categoría es un curso. Después de publicar, podés asignar desde la edición de qué
          otra lección depende este recurso.
        </p>
      ) : null}
    </div>
  )
}
