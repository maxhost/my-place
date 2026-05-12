import Link from 'next/link'
import type { LibraryCategory, LibraryCategoryContributor } from '@/features/library/public'
import { contributionPolicyLabel } from './contribution-policy-label'

type Props = {
  /** Categorías activas (no archivadas) — el listado del admin (master pane). */
  categories: ReadonlyArray<LibraryCategory>
  /** Map de contributors por categoryId — precargado en el layout. Se usa
   *  para mostrar el count "N con permiso" en cada row sin lookups extra. */
  contributorsByCategory: ReadonlyMap<string, ReadonlyArray<LibraryCategoryContributor>>
}

/**
 * Master pane: listado de categorías como rows tappables que navegan al
 * detail page `/settings/library/[categoryId]`. Las acciones (Editar,
 * Contribuidores, Archivar) viven ahora en el detail page — esta master
 * list solo es navegación.
 *
 * **Refactor 2026-05-12 (master-detail):** previamente cada row tenía
 * action buttons inline (Editar/Contribuidores/Archivar). Migrado al
 * patrón canon `docs/ux-patterns.md` § "Master-detail layout": el master
 * pane es solo navegación, el detail es donde se editan los items.
 *
 * Server Component — sin state, sin dialogs. Los Links activan el routing
 * de Next 15 que carga el detail page.
 */
export function CategoryListAdmin({ categories, contributorsByCategory }: Props): React.ReactNode {
  if (categories.length === 0) {
    return (
      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-6 text-sm italic text-neutral-500">
        Todavía no hay categorías. Creá la primera para empezar a organizar la biblioteca.
      </div>
    )
  }

  return (
    <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
      {categories.map((category) => {
        const contributors = contributorsByCategory.get(category.id) ?? []
        return (
          <li key={category.id}>
            <Link
              href={`/settings/library/${category.id}`}
              className="flex min-h-[56px] items-center gap-3 px-3 py-3 hover:bg-neutral-50"
            >
              <span aria-hidden className="text-2xl leading-none">
                {category.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-serif text-base">{category.title}</h3>
                <p className="truncate text-xs text-neutral-600">
                  <span>/library/{category.slug}</span>
                  <span className="mx-1.5">·</span>
                  <span>{contributionPolicyLabel(category.contributionPolicy)}</span>
                  {category.contributionPolicy === 'DESIGNATED' ? (
                    <>
                      <span className="mx-1.5">·</span>
                      <span>{contributors.length} con permiso</span>
                    </>
                  ) : null}
                </p>
              </div>
              <span aria-hidden="true" className="shrink-0 text-neutral-400">
                ›
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
