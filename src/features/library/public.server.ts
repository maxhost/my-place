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
  findLibraryCategoryById,
  findLibraryCategoryBySlug,
  listCategoryContributorUserIds,
  listCategoryContributors,
  listLibraryCategories,
  type ListLibraryCategoriesOptions,
} from './server/queries'
