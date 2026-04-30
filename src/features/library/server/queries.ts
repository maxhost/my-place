import 'server-only'
import { prisma } from '@/db/client'
import type { LibraryCategory, LibraryCategoryContributor } from '../domain/types'

/**
 * Queries del slice `library` (R.7.2 — solo categorías).
 *
 * Solo este archivo + `server/actions/*` tocan Prisma. El resto del
 * slice (UI, domain) consume via `public.ts` / `public.server.ts`.
 *
 * RLS está activa sobre `LibraryCategory` y `LibraryCategoryContributor`
 * (migration 20260430000000) — un viewer sin membership activa nunca
 * ve filas via authenticated client. Acá usamos el `prisma` singleton
 * (service role) que bypassea RLS, así que aplicamos el filtro por
 * place explícitamente en el WHERE para mantener igualdad funcional.
 *
 * Ver `docs/features/library/spec.md` § 10.
 */

// ---------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------

type CategoryRow = {
  id: string
  slug: string
  emoji: string
  title: string
  position: number | null
  contributionPolicy: 'ADMIN_ONLY' | 'DESIGNATED' | 'MEMBERS_OPEN'
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function mapCategoryRow(row: CategoryRow, docCount: number): LibraryCategory {
  return {
    id: row.id,
    slug: row.slug,
    emoji: row.emoji,
    title: row.title,
    position: row.position,
    contributionPolicy: row.contributionPolicy,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    docCount,
  }
}

// ---------------------------------------------------------------
// Categories — list / find
// ---------------------------------------------------------------

export type ListLibraryCategoriesOptions = {
  /** Si true, incluye categorías archivadas (admin view). Default false. */
  includeArchived?: boolean
}

/**
 * Lista categorías de un place ordenadas por (position ASC NULLS LAST,
 * createdAt ASC). NULLS LAST = categorías nuevas no reordenadas
 * aparecen al final del orden visual.
 *
 * `docCount` es 0 hasta R.7.5+ (cuando exista `LibraryItem`). En R.7.2
 * la sub-query no se hace — placeholder fijo.
 */
export async function listLibraryCategories(
  placeId: string,
  opts: ListLibraryCategoriesOptions = {},
): Promise<LibraryCategory[]> {
  const rows = await prisma.libraryCategory.findMany({
    where: {
      placeId,
      ...(opts.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ position: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    select: {
      id: true,
      slug: true,
      emoji: true,
      title: true,
      position: true,
      contributionPolicy: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  // R.7.2: docCount = 0 (LibraryItem todavía no existe). R.7.6 lo
  // reemplazará por una sub-query de count. Mantener este placeholder
  // explícito en lugar de borrarlo del shape — los componentes UI
  // R.5 ya consumen `category.docCount`.
  return rows.map((r) => mapCategoryRow(r, 0))
}

/**
 * Resuelve una categoría por slug dentro de un place. Devuelve null si
 * no existe o está archivada (las archivadas se filtran salvo que
 * `includeArchived` se pase explícitamente — útil para admin restore).
 */
export async function findLibraryCategoryBySlug(
  placeId: string,
  slug: string,
  opts: { includeArchived?: boolean } = {},
): Promise<LibraryCategory | null> {
  const row = await prisma.libraryCategory.findUnique({
    where: { placeId_slug: { placeId, slug } },
    select: {
      id: true,
      slug: true,
      emoji: true,
      title: true,
      position: true,
      contributionPolicy: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (!row) return null
  if (!opts.includeArchived && row.archivedAt) return null
  return mapCategoryRow(row, 0)
}

/**
 * Resuelve una categoría por id (admin actions, eventos system).
 * Acepta archivadas para no romper flows de "des-archivar".
 */
export async function findLibraryCategoryById(categoryId: string): Promise<LibraryCategory | null> {
  const row = await prisma.libraryCategory.findUnique({
    where: { id: categoryId },
    select: {
      id: true,
      slug: true,
      emoji: true,
      title: true,
      position: true,
      contributionPolicy: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (!row) return null
  return mapCategoryRow(row, 0)
}

/**
 * Cuenta categorías no archivadas del place. Usada por
 * `assertCategoryCapacity` antes del create.
 */
export async function countLibraryCategories(placeId: string): Promise<number> {
  return prisma.libraryCategory.count({
    where: { placeId, archivedAt: null },
  })
}

// ---------------------------------------------------------------
// Contributors
// ---------------------------------------------------------------

/**
 * Lista contributors designated de una categoría con datos de User
 * para renderizar avatar + nombre sin queries N+1.
 */
export async function listCategoryContributors(
  categoryId: string,
): Promise<LibraryCategoryContributor[]> {
  const rows = await prisma.libraryCategoryContributor.findMany({
    where: { categoryId },
    orderBy: { invitedAt: 'asc' },
    select: {
      categoryId: true,
      userId: true,
      invitedAt: true,
      invitedByUserId: true,
      user: {
        select: { displayName: true, avatarUrl: true },
      },
      invitedBy: {
        select: { displayName: true },
      },
    },
  })
  return rows.map((r) => ({
    categoryId: r.categoryId,
    userId: r.userId,
    displayName: r.user.displayName,
    avatarUrl: r.user.avatarUrl,
    invitedAt: r.invitedAt,
    invitedByUserId: r.invitedByUserId,
    invitedByDisplayName: r.invitedBy.displayName,
  }))
}

/**
 * Devuelve solo los userIds de contributors — útil para
 * `canCreateInCategory` sin pagar el JOIN si solo necesitamos auth.
 */
export async function listCategoryContributorUserIds(categoryId: string): Promise<string[]> {
  const rows = await prisma.libraryCategoryContributor.findMany({
    where: { categoryId },
    select: { userId: true },
  })
  return rows.map((r) => r.userId)
}

/**
 * Batch query: contributors agrupados por `categoryId`. Usada por la
 * page admin para precargar la lista de todas las categorías
 * `DESIGNATED` sin N+1.
 *
 * Devuelve un `Map<categoryId, contributors[]>`. Categorías sin
 * contributors no aparecen en el Map (caller chequea
 * `map.get(id) ?? []`).
 */
export async function listContributorsByCategoryIds(
  categoryIds: ReadonlyArray<string>,
): Promise<Map<string, LibraryCategoryContributor[]>> {
  if (categoryIds.length === 0) return new Map()
  const rows = await prisma.libraryCategoryContributor.findMany({
    where: { categoryId: { in: [...categoryIds] } },
    orderBy: { invitedAt: 'asc' },
    select: {
      categoryId: true,
      userId: true,
      invitedAt: true,
      invitedByUserId: true,
      user: {
        select: { displayName: true, avatarUrl: true },
      },
      invitedBy: {
        select: { displayName: true },
      },
    },
  })
  const map = new Map<string, LibraryCategoryContributor[]>()
  for (const r of rows) {
    const existing = map.get(r.categoryId) ?? []
    existing.push({
      categoryId: r.categoryId,
      userId: r.userId,
      displayName: r.user.displayName,
      avatarUrl: r.user.avatarUrl,
      invitedAt: r.invitedAt,
      invitedByUserId: r.invitedByUserId,
      invitedByDisplayName: r.invitedBy.displayName,
    })
    map.set(r.categoryId, existing)
  }
  return map
}
