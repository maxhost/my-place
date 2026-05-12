import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { listActiveMembers } from '@/features/members/public.server'
import {
  ArchiveCategoryButton,
  CategoryFormDialog,
  ContributorsDialog,
} from '@/features/library/public'
import { findLibraryCategoryById, listCategoryContributors } from '@/features/library/public.server'
import { PageHeader } from '@/shared/ui/page-header'

type Props = {
  placeSlug: string
  categoryId: string
}

/**
 * Content compartido del detail de una categoría de biblioteca. Único
 * consumer hoy: `[categoryId]/page.tsx`, renderizado como `{children}` del
 * layout master-detail.
 *
 * Estructura del detail:
 *  - Back link "← Volver a Biblioteca" (`md:hidden`, solo mobile).
 *  - `<PageHeader>` con emoji + título de la categoría.
 *  - Section "Información": metadatos + botón Editar (abre CategoryFormDialog).
 *  - Section "Contribuidores" (solo si policy=DESIGNATED): list de
 *    contributors + botón "Gestionar" (abre ContributorsDialog).
 *  - Section "Archivar": copy + ArchiveCategoryButton (amber recoverable).
 *
 * Futuro (R.7.5+): sección "Items" con lista de items de la categoría +
 * crear/editar inline. Section "Permisos de lectura" (G.1) con scope picker.
 *
 * Gate de visibilidad heredado del layout padre `/settings/layout.tsx`
 * (admin/owner). El layout master-detail también gateá. No re-validamos
 * acá — defensa en profundidad ya cubierta.
 */
export async function CategoryDetailContent({
  placeSlug,
  categoryId,
}: Props): Promise<React.ReactNode> {
  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) {
    notFound()
  }

  const category = await findLibraryCategoryById(categoryId)
  if (!category || category.placeId !== place.id || category.archivedAt) {
    notFound()
  }

  const [contributors, activeMembers] = await Promise.all([
    listCategoryContributors(category.id),
    listActiveMembers(place.id),
  ])

  const memberOptions = activeMembers.map((m) => ({
    userId: m.userId,
    displayName: m.user.displayName,
    avatarUrl: m.user.avatarUrl,
    handle: m.user.handle,
  }))

  return (
    <div className="space-y-6 px-3 py-6 md:px-4 md:py-8">
      <Link
        href="/settings/library"
        className="inline-block text-sm text-neutral-600 hover:text-neutral-900 md:hidden"
      >
        ← Volver a Biblioteca
      </Link>

      <PageHeader
        title={`${category.emoji} ${category.title}`}
        description={`Slug: /library/${category.slug}`}
      />

      <section aria-labelledby="category-info-heading" className="space-y-3">
        <h2
          id="category-info-heading"
          className="border-b pb-2 font-serif text-xl"
          style={{ borderColor: 'var(--border)' }}
        >
          Información
        </h2>
        <div className="rounded-md border border-neutral-200 px-3 py-3">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-600">Emoji</dt>
              <dd aria-label={`Emoji actual: ${category.emoji}`} className="text-xl leading-none">
                {category.emoji}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-600">Título</dt>
              <dd className="truncate font-medium text-neutral-900">{category.title}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-600">Slug</dt>
              <dd className="truncate font-mono text-xs text-neutral-700">
                /library/{category.slug}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-neutral-600">Quién puede contribuir</dt>
              <dd className="text-neutral-900">
                {category.contributionPolicy === 'DESIGNATED'
                  ? 'Designados'
                  : category.contributionPolicy === 'MEMBERS_OPEN'
                    ? 'Cualquier miembro'
                    : 'Grupos seleccionados'}
              </dd>
            </div>
          </dl>
        </div>
        <CategoryFormDialog
          mode={{
            kind: 'edit',
            categoryId: category.id,
            initialEmoji: category.emoji,
            initialTitle: category.title,
            initialPolicy: category.contributionPolicy,
          }}
          trigger={
            <button
              type="button"
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-50"
            >
              Editar información
            </button>
          }
        />
      </section>

      {category.contributionPolicy === 'DESIGNATED' ? (
        <section aria-labelledby="category-contributors-heading" className="space-y-3">
          <h2
            id="category-contributors-heading"
            className="border-b pb-2 font-serif text-xl"
            style={{ borderColor: 'var(--border)' }}
          >
            Contribuidores
          </h2>
          <p className="text-xs text-neutral-600">
            {contributors.length === 0
              ? 'Esta categoría todavía no tiene contribuidores designados.'
              : `${contributors.length} ${contributors.length === 1 ? 'miembro puede contribuir' : 'miembros pueden contribuir'}.`}
          </p>
          <ContributorsDialog
            categoryId={category.id}
            categoryTitle={category.title}
            initialContributors={contributors}
            members={memberOptions}
            trigger={
              <button
                type="button"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-50"
              >
                Gestionar contribuidores
              </button>
            }
          />
        </section>
      ) : null}

      <section aria-labelledby="category-archive-heading" className="space-y-3">
        <h2
          id="category-archive-heading"
          className="border-b pb-2 font-serif text-xl"
          style={{ borderColor: 'var(--border)' }}
        >
          Archivar
        </h2>
        <p className="text-sm text-neutral-600">
          Archivar la categoría la oculta del listado público de la biblioteca. Los items existentes
          quedan archivados también. Esta acción es reversible desde la base de datos.
        </p>
        <ArchiveCategoryButton categoryId={category.id} categoryTitle={category.title} />
      </section>
    </div>
  )
}
