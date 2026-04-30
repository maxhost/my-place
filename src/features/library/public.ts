/**
 * API pública del slice `library`.
 *
 * R.5 (UI scaffold): tipos UI + componentes Server/Client.
 * R.7 (backend): suma tipos canónicos del dominio + actions client-safe
 * (Server Actions con `'use server'` viajan al bundle cliente como
 * referencias serializadas — no son código). Para queries Prisma usar
 * `public.server.ts`.
 *
 * Ver `docs/features/library/spec.md`.
 */

// ---------------------------------------------------------------
// Domain types — contrato que la UI espera
// ---------------------------------------------------------------

export type {
  ContributionPolicy,
  DocType, // @deprecated R.7 — retenido para compat con componentes R.5
  LibraryCategory,
  LibraryCategoryContributor,
  LibraryDoc, // @deprecated R.7 — retenido para compat con componentes R.5
} from './domain/types'

export { CONTRIBUTION_POLICY_VALUES } from './domain/types'

// ---------------------------------------------------------------
// Permissions — funciones puras reusables (UI + server)
// ---------------------------------------------------------------

export {
  canArchiveItem,
  canCreateInCategory,
  canEditCategory,
  canEditItem,
  type CategoryForPermissions,
  type LibraryViewer,
} from './domain/permissions'

// ---------------------------------------------------------------
// Invariants / domain constants — útiles para UI hints
// ---------------------------------------------------------------

export {
  CATEGORY_EMOJI_MAX_LENGTH,
  CATEGORY_TITLE_MAX_LENGTH,
  CATEGORY_TITLE_MIN_LENGTH,
  MAX_CATEGORIES_PER_PLACE,
} from './domain/invariants'

// ---------------------------------------------------------------
// Server actions (R.7.2) — Server Action references viajan client-safe
// ---------------------------------------------------------------

export { archiveLibraryCategoryAction } from './server/actions/archive-category'
export { createLibraryCategoryAction } from './server/actions/create-category'
export { inviteContributorAction } from './server/actions/invite-contributor'
export { removeContributorAction } from './server/actions/remove-contributor'
export { reorderLibraryCategoriesAction } from './server/actions/reorder-categories'
export { updateLibraryCategoryAction } from './server/actions/update-category'

// ---------------------------------------------------------------
// UI admin (R.7.3) — settings/library
// ---------------------------------------------------------------

export { ArchiveCategoryButton } from './ui/admin/archive-category-button'
export { CategoryFormDialog } from './ui/admin/category-form-dialog'
export { CategoryListAdmin } from './ui/admin/category-list-admin'
export { ContributorsDialog } from './ui/admin/contributors-dialog'
export {
  contributionPolicyDescription,
  contributionPolicyLabel,
} from './ui/admin/contribution-policy-label'
export { friendlyLibraryErrorMessage } from './ui/admin/errors'

// ---------------------------------------------------------------
// UI components — Server Components salvo `<TypeFilterPills>`
// ---------------------------------------------------------------

export { CategoryCard } from './ui/category-card'
export { CategoryGrid } from './ui/category-grid'
export { CategoryHeaderBar } from './ui/category-header-bar'
export { DocList } from './ui/doc-list'
export { EmptyDocList } from './ui/empty-doc-list'
export { EmptyLibrary } from './ui/empty-library'
export { FileIcon } from './ui/file-icon'
export { LibrarySectionHeader } from './ui/library-section-header'
export { RecentDocRow } from './ui/recent-doc-row'
export { RecentsList } from './ui/recents-list'
export { TypeFilterPills } from './ui/type-filter-pills'
