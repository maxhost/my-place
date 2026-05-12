import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import {
  CategoryListAdmin,
  CategoryFormDialog,
  MAX_CATEGORIES_PER_PLACE,
} from '@/features/library/public'
import {
  listContributorsByCategoryIds,
  listLibraryCategories,
} from '@/features/library/public.server'
import { PageHeader } from '@/shared/ui/page-header'
import { MasterDetailLayout } from '@/shared/ui/master-detail-layout'

type Props = {
  children: React.ReactNode
  params: Promise<{ placeSlug: string }>
}

/**
 * Layout master-detail de `/settings/library/*`.
 *
 * Aplica el patrón canónico documentado en `docs/ux-patterns.md` § "Master-detail
 * layout" — mismo approach que `/settings/groups`:
 *
 *  - **Master pane (lista)** vive ACÁ, server-rendered una vez. Persiste
 *    al navegar entre `/settings/library` y `/settings/library/[categoryId]`
 *    (Next 15 reusa layouts entre routes hermanas → sin re-fetch).
 *  - **Detail pane (`{children}`)**:
 *     - `/settings/library` → `page.tsx` (placeholder "Elegí una categoría").
 *     - `/settings/library/[categoryId]` → `[categoryId]/page.tsx` (detail).
 *  - **Mobile**: `<MasterDetailLayout hasDetail>` esconde el master cuando
 *    hay detail (full-screen). El detail incluye back link `md:hidden`.
 *  - **Desktop**: split view (master 360px + detail).
 *
 * Gate admin/owner heredado del layout padre `/settings/layout.tsx` (no
 * re-validamos acá). Esta sub-page NO es owner-only — admin con permiso
 * `library:moderate-categories` puede gestionar.
 *
 * Decisión 2026-05-12: migrar a master-detail AHORA (no esperar R.7.5
 * items). Cuando lleguen items + permisos de read access, el detail page
 * sumará secciones — la estructura ya está lista.
 */
export default async function LibraryMasterDetailLayout({
  children,
  params,
}: Props): Promise<React.ReactNode> {
  const { placeSlug } = await params

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) {
    notFound()
  }

  const categories = await listLibraryCategories(place.id)

  // Contributors batch query — solo para categorías DESIGNATED. Las que no
  // figuran en el Map no tienen contributors (policy distinta).
  const designatedIds = categories
    .filter((c) => c.contributionPolicy === 'DESIGNATED')
    .map((c) => c.id)
  const contributorsByCategory = await listContributorsByCategoryIds(designatedIds)

  const remaining = MAX_CATEGORIES_PER_PLACE - categories.length
  const canCreateMore = remaining > 0

  // hasDetail derivado del pathname: si tenemos /settings/library/<id> y
  // ese id no está vacío, mobile esconde la lista. Desktop muestra ambos.
  const headerStore = await headers()
  const pathname = headerStore.get('x-pathname') ?? ''
  const hasDetail = /^\/settings\/library\/[^/]+/.test(pathname)

  const masterPane = (
    <div className="space-y-6 px-3 py-6 md:px-4 md:py-8">
      <PageHeader
        title="Biblioteca"
        description="Las categorías agrupan los recursos de la biblioteca. Definí emoji, título y quién puede agregar contenido."
      />

      <section aria-labelledby="library-categories-heading" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2
            id="library-categories-heading"
            className="flex-1 border-b pb-2 font-serif text-xl"
            style={{ borderColor: 'var(--border)' }}
          >
            Categorías
          </h2>
          <span className="text-xs text-neutral-600">
            {categories.length}
            {canCreateMore ? ` de ${MAX_CATEGORIES_PER_PLACE}` : ' — máximo'}
          </span>
        </div>

        <CategoryListAdmin
          categories={categories}
          contributorsByCategory={contributorsByCategory}
        />

        {canCreateMore ? (
          <CategoryFormDialog
            mode={{ kind: 'create', placeId: place.id }}
            trigger={
              <span className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 px-4 text-sm font-medium text-neutral-600 hover:border-neutral-500">
                <span aria-hidden="true">+</span> Nueva categoría
              </span>
            }
          />
        ) : (
          <p className="text-xs italic text-neutral-500">
            Llegaste al máximo de {MAX_CATEGORIES_PER_PLACE} categorías. Archivá alguna para crear
            otra.
          </p>
        )}
      </section>
    </div>
  )

  return (
    <MasterDetailLayout
      master={masterPane}
      detail={children}
      hasDetail={hasDetail}
      masterLabel="Lista de categorías"
      detailLabel="Detalle de la categoría"
    />
  )
}
