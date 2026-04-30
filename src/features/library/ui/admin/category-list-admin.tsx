import type { LibraryCategory, LibraryCategoryContributor } from '@/features/library/public'
import { ArchiveCategoryButton } from './archive-category-button'
import { CategoryFormDialog } from './category-form-dialog'
import { ContributorsDialog } from './contributors-dialog'
import { contributionPolicyLabel } from './contribution-policy-label'

type MemberOption = {
  userId: string
  displayName: string
  avatarUrl: string | null
  handle: string | null
}

type Props = {
  /** Categorías activas (no archivadas) — el listado del admin. */
  categories: ReadonlyArray<LibraryCategory>
  /** Members activos del place — pasados al `<ContributorsDialog>`
   *  cuando una categoría tiene policy=DESIGNATED. */
  members: ReadonlyArray<MemberOption>
  /** Map de contributors por categoryId — precargado en el page. Las
   *  categorías que no figuran en el Map no tienen contributors. */
  contributorsByCategory: ReadonlyMap<string, ReadonlyArray<LibraryCategoryContributor>>
}

/**
 * Listado admin de categorías. Server Component que renderiza una row
 * por categoría con: emoji, título, slug, policy label, botón Editar
 * (abre `<CategoryFormDialog mode="edit">`), botón Contribuidores
 * (solo si policy=DESIGNATED), y Archivar (abre confirm).
 */
export function CategoryListAdmin({
  categories,
  members,
  contributorsByCategory,
}: Props): React.ReactNode {
  if (categories.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-sm italic text-muted">
        Todavía no hay categorías. Creá la primera para empezar a organizar la biblioteca.
      </div>
    )
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {categories.map((category) => {
        const contributors = contributorsByCategory.get(category.id) ?? []
        return (
          <li key={category.id} className="flex items-center gap-3 px-4 py-3">
            <span aria-hidden className="text-2xl leading-none">
              {category.emoji}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="truncate font-title text-base font-semibold text-text">
                {category.title}
              </h3>
              <p className="truncate text-xs text-muted">
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
            <div className="flex shrink-0 gap-2">
              <CategoryFormDialog
                mode={{
                  kind: 'edit',
                  categoryId: category.id,
                  initialEmoji: category.emoji,
                  initialTitle: category.title,
                  initialPolicy: category.contributionPolicy,
                }}
                trigger={
                  <span className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted hover:text-text">
                    Editar
                  </span>
                }
              />
              {category.contributionPolicy === 'DESIGNATED' ? (
                <ContributorsDialog
                  categoryId={category.id}
                  categoryTitle={category.title}
                  initialContributors={contributors}
                  members={members}
                  trigger={
                    <span className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted hover:text-text">
                      Contribuidores
                    </span>
                  }
                />
              ) : null}
              <ArchiveCategoryButton categoryId={category.id} categoryTitle={category.title} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
