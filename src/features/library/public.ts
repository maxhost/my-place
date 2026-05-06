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
  ItemAuthorSnapshot,
  LibraryCategory,
  LibraryCategoryContributor,
  LibraryCategoryKind,
  LibraryItemDetailView,
  LibraryItemListView,
  LibraryReadAccessKind,
} from './domain/types'

export {
  CONTRIBUTION_POLICY_VALUES,
  LIBRARY_CATEGORY_KIND_VALUES,
  LIBRARY_READ_ACCESS_KIND_VALUES,
} from './domain/types'

// ---------------------------------------------------------------
// Embed parser + provider type (R.7.7)
// ---------------------------------------------------------------

export type { EmbedProvider, ParsedEmbed } from './domain/embed-parser'
export { EMBED_PROVIDERS, parseEmbedUrl } from './domain/embed-parser'

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
  CATEGORY_EMOJI_MIN_LENGTH,
  CATEGORY_TITLE_MAX_LENGTH,
  CATEGORY_TITLE_MIN_LENGTH,
  ITEM_COVER_URL_MAX_LENGTH,
  ITEM_TITLE_MAX_LENGTH,
  ITEM_TITLE_MIN_LENGTH,
  MAX_CATEGORIES_PER_PLACE,
  validateItemCoverUrl,
} from './domain/invariants'

// ---------------------------------------------------------------
// Server actions (R.7.2) — Server Action references viajan client-safe
// ---------------------------------------------------------------

export { archiveLibraryCategoryAction } from './server/actions/archive-category'
export { archiveLibraryItemAction } from './items/server/actions/archive-item'
export { createLibraryCategoryAction } from './server/actions/create-category'
export { createLibraryItemAction } from './items/server/actions/create-item'
export { inviteContributorAction } from './server/actions/invite-contributor'
export { removeContributorAction } from './server/actions/remove-contributor'
export { reorderLibraryCategoriesAction } from './server/actions/reorder-categories'
export { setLibraryCategoryDesignatedContributorsAction } from './contributors/server/actions/set-designated-contributors'
export { setLibraryCategoryGroupScopeAction } from './contributors/server/actions/set-category-group-scope'
export { updateLibraryCategoryAction } from './server/actions/update-category'
export { updateLibraryItemAction } from './items/server/actions/update-item'

// ---------------------------------------------------------------
// Zod schemas + inferred types — input shapes para server actions
// ---------------------------------------------------------------

export {
  setLibraryCategoryDesignatedContributorsInputSchema,
  setLibraryCategoryGroupScopeInputSchema,
} from './schemas'
export type {
  SetLibraryCategoryDesignatedContributorsInput,
  SetLibraryCategoryGroupScopeInput,
} from './schemas'

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

// stub F.1: EmbedNodeExtension/View/Toolbar + LibraryItemEditor/Form eliminados.
// F.4 reintroduce el composer Lexical de items con embeds desde el slice `rich-text/`.

// Item detail UI (R.7.9)
export { ItemAdminMenu } from './ui/item-admin-menu'
export { LibraryItemHeader } from './ui/library-item-header'
export { LibraryItemHeaderBar } from './ui/library-item-header-bar'

export { CategoryCard } from './ui/category-card'
export { CategoryGrid } from './ui/category-grid'
export { CategoryHeaderBar } from './ui/category-header-bar'
export { EmptyItemList } from './ui/empty-item-list'
export { EmptyLibrary } from './ui/empty-library'
export { ItemList } from './ui/item-list'
export { LibraryItemRow } from './ui/library-item-row'
export { LibrarySectionHeader } from './ui/library-section-header'
export { RecentsList } from './ui/recents-list'
