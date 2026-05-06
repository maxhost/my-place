import 'server-only'

/**
 * Superficie pública server-only del slice `library`. Queries Prisma
 * y helpers que nunca deben viajar al bundle cliente.
 *
 * Server Components y server actions consumen acá; Client Components
 * consumen solo `public.ts`. Ver
 * `docs/decisions/2026-04-21-flags-subslice-split.md` § "Boundary
 * client vs server".
 */

export {
  countLibraryCategories,
  findItemBySlug,
  findItemForAction,
  findLibraryCategoryById,
  findLibraryCategoryBySlug,
  listItemsByCategory,
  listLibraryCategories,
  listRecentItems,
  type ListLibraryCategoriesOptions,
} from './server/queries'

// Re-export desde sub-slice `contributors/`. El consumer canónico es
// `<ZoneFab>` en `features/shell/`, que necesita este lookup vía la
// public surface del slice library (no del sub-slice) — el test de
// boundaries de la versión actual sólo whitelistea `<feature>/public`
// y `<feature>/public.server` como entry-point.
export {
  canCreateInAnyCategoryForViewer,
  listCategoryContributorUserIds,
  listCategoryContributors,
  listContributorsByCategoryIds,
} from './contributors/public.server'

// Helpers de revalidate y resolución de viewer — usados por Server
// Components y server actions cross-slice (ej: features/shell/).
export { revalidateLibraryCategoryPaths, revalidateLibraryItemPaths } from './server/actions/shared'
export { resolveLibraryViewer, type LibraryViewerContext } from './server/viewer'

// F.4 (rich-text): autocomplete `/library/<cat>/<item>` two-step para
// composers (Post / Library / Event). Cacheado.
export {
  listCategoriesForMention,
  searchLibraryItems,
  type MentionLibraryCategory,
  type MentionLibraryItem,
} from './server/mention-search'
