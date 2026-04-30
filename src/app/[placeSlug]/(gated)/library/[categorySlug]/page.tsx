import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { resolveViewerForPlace } from '@/features/discussions/public.server'
import {
  CategoryHeaderBar,
  EmptyItemList,
  ItemList,
  canCreateInCategory,
} from '@/features/library/public'
import {
  findLibraryCategoryBySlug,
  listCategoryContributorUserIds,
  listItemsByCategory,
} from '@/features/library/public.server'

type Props = {
  params: Promise<{ placeSlug: string; categorySlug: string }>
}

/**
 * Sub-page de categoría (R.7.10 — backend conectado).
 *
 * Resuelve la categoría, lista sus items, evalúa permisos del viewer
 * para decidir si renderiza el botón "Nuevo" + el CTA del empty state.
 *
 * Categorías archivadas: 404 para members, visibles para admin (la
 * RLS de SELECT ya enforce esto, acá adicional `notFound()` defensivo
 * para members con archivedAt poblado).
 *
 * Ver `docs/features/library/spec.md` § 4 + § 6.
 */
export default async function LibraryCategoryPage({ params }: Props) {
  const { placeSlug, categorySlug } = await params

  const place = await loadPlaceBySlug(placeSlug)
  if (!place) notFound()

  const viewer = await resolveViewerForPlace({ placeSlug })
  const category = await findLibraryCategoryBySlug(place.id, categorySlug, {
    includeArchived: viewer.isAdmin,
  })
  if (!category) notFound()
  if (category.archivedAt && !viewer.isAdmin) notFound()

  const designatedUserIds =
    category.contributionPolicy === 'DESIGNATED'
      ? await listCategoryContributorUserIds(category.id)
      : []
  const canCreate = canCreateInCategory(
    {
      contributionPolicy: category.contributionPolicy,
      designatedUserIds,
    },
    { userId: viewer.actorId, isAdmin: viewer.isAdmin },
  )

  const items = await listItemsByCategory(category.id)

  return (
    <div className="pb-6">
      <CategoryHeaderBar
        rightSlot={
          canCreate ? (
            <Link
              href={`/library/${category.slug}/new`}
              className="rounded-md bg-accent px-3 py-1.5 text-xs text-bg"
            >
              Nuevo
            </Link>
          ) : null
        }
      />
      <header className="mt-4 px-3">
        <h1 className="font-title text-[28px] font-bold text-text">
          {category.emoji} {category.title}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {items.length === 0
            ? 'Sin recursos todavía'
            : items.length === 1
              ? '1 recurso'
              : `${items.length} recursos`}
          {category.archivedAt ? ' · archivada' : ''}
        </p>
      </header>

      <div className="mt-4">
        {items.length === 0 ? (
          <EmptyItemList canCreate={canCreate} categorySlug={category.slug} />
        ) : (
          <ItemList items={items} />
        )}
      </div>
    </div>
  )
}
