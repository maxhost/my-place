import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { resolveViewerForPlace } from '@/features/discussions/public.server'
import {
  LibraryItemForm,
  canCreateInCategory,
  type CategoryOption,
} from '@/features/library/public'
import {
  listContributorsByCategoryIds,
  listLibraryCategories,
} from '@/features/library/public.server'

type Props = {
  params: Promise<{ placeSlug: string }>
}

/**
 * Compositor de un nuevo item desde la zona biblioteca (R.7.X).
 *
 * Flow: el FAB cross-zona "Nuevo recurso" linkea acá cuando el user
 * no está dentro de una categoría específica. El form muestra un
 * selector con las categorías donde el viewer puede crear (filtradas
 * por contributionPolicy + permisos del viewer).
 *
 * Si el user no tiene permisos en ninguna categoría, el form muestra
 * un mensaje sin selector ("pedile a un admin que…").
 *
 * Cuando el user llega vía `/library/[cat]/new`, esa page sigue
 * usando el form con `fixedCategory` (sin selector).
 */
export default async function NewLibraryItemAtRootPage({ params }: Props) {
  const { placeSlug } = await params

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) notFound()

  const viewer = await resolveViewerForPlace({ placeSlug })

  const categories = await listLibraryCategories(place.id)

  // Pre-cargamos contributors para todas las DESIGNATED en una query
  // batch. Para policies ADMIN_ONLY / MEMBERS_OPEN no necesitamos la
  // lista — el can-check resuelve sin ella.
  const designatedIds = categories
    .filter((c) => c.contributionPolicy === 'DESIGNATED')
    .map((c) => c.id)
  const contributorsByCategory = await listContributorsByCategoryIds(designatedIds)

  const allowedCategories: CategoryOption[] = categories
    .filter((cat) => {
      const designatedUserIds =
        cat.contributionPolicy === 'DESIGNATED'
          ? (contributorsByCategory.get(cat.id) ?? []).map((c) => c.userId)
          : []
      return canCreateInCategory(
        {
          contributionPolicy: cat.contributionPolicy,
          designatedUserIds,
        },
        { userId: viewer.actorId, isAdmin: viewer.isAdmin },
      )
    })
    .map((cat) => ({
      id: cat.id,
      slug: cat.slug,
      emoji: cat.emoji,
      title: cat.title,
    }))

  return (
    <div className="px-3 py-6">
      <header className="mb-5">
        <p className="text-sm text-muted">Biblioteca</p>
        <h1 className="font-title text-[26px] font-bold tracking-[-0.6px] text-text">
          Nuevo recurso
        </h1>
      </header>

      <LibraryItemForm
        mode={{
          kind: 'create',
          placeId: place.id,
          fixedCategory: null,
          availableCategories: allowedCategories,
        }}
      />
    </div>
  )
}
