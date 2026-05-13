import 'server-only'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/db/client'
import type { ContributionPolicy, LibraryCategory } from '@/features/library/domain/types'

/**
 * Queries de categorías. Solo este archivo + hermanos en server/* tocan
 * Prisma. RLS activa sobre LibraryCategory pero acá usamos service role
 * (singleton) — el caller debe gatear membership por place explícitamente.
 *
 * L.PERF (2026-05-04): los listados/find de categorías NO dependen del
 * viewer (la lectura por usuario ocurre al ABRIR un item, no al listar
 * categorías) — por eso se envuelven con `unstable_cache` con
 * `revalidate: 30` y tag `place:<placeId>:library-categories`. Las
 * mutation actions invalidan ese tag via `revalidateLibraryCategoryPaths`.
 * Cache key incluye `placeId` (evita cross-tenant leak) + serialización
 * de opts (incluye/excluye archivadas).
 */

const CATEGORIES_CACHE_REVALIDATE_SECONDS = 30
const categoriesTag = (placeId: string) => `place:${placeId}:library-categories`

// ---------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------

type CategoryRow = {
  id: string
  placeId: string
  slug: string
  emoji: string
  title: string
  position: number | null
  contributionPolicy: ContributionPolicy
  kind: 'GENERAL' | 'COURSE'
  readAccessKind: 'PUBLIC' | 'GROUPS' | 'TIERS' | 'USERS'
  writeAccessKind: 'OWNER_ONLY' | 'GROUPS' | 'TIERS' | 'USERS'
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
  _count?: { items: number }
  /** LEGACY: JOIN con GroupCategoryScope. Vacío salvo policy=SELECTED_GROUPS. */
  groupScopes?: ReadonlyArray<{ groupId: string }>
}

function mapCategoryRow(row: CategoryRow, docCount: number): LibraryCategory {
  return {
    id: row.id,
    placeId: row.placeId,
    slug: row.slug,
    emoji: row.emoji,
    title: row.title,
    position: row.position,
    contributionPolicy: row.contributionPolicy,
    kind: row.kind,
    readAccessKind: row.readAccessKind,
    writeAccessKind: row.writeAccessKind,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    docCount,
    groupScopeIds: (row.groupScopes ?? []).map((g) => g.groupId),
  }
}

/** Select compartido — los 3 helpers exponen el mismo shape de fila. */
const CATEGORY_SELECT = {
  id: true,
  placeId: true,
  slug: true,
  emoji: true,
  title: true,
  position: true,
  contributionPolicy: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  kind: true,
  readAccessKind: true,
  writeAccessKind: true,
  _count: { select: { items: { where: { archivedAt: null } } } },
  /** LEGACY: JOIN inline con GroupCategoryScope (cap ≤ 50 entries). */
  groupScopes: { select: { groupId: true } },
} as const

// ---------------------------------------------------------------
// List / find
// ---------------------------------------------------------------

export type ListLibraryCategoriesOptions = {
  /** Default false. true incluye archivadas (admin view). */
  includeArchived?: boolean
}

/** Orden visual: position ASC NULLS LAST → createdAt ASC (las nuevas no
 *  reordenadas aparecen al final). */
export async function listLibraryCategories(
  placeId: string,
  opts: ListLibraryCategoriesOptions = {},
): Promise<LibraryCategory[]> {
  return unstable_cache(
    async () => {
      const rows = await prisma.libraryCategory.findMany({
        where: { placeId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
        orderBy: [{ position: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        select: CATEGORY_SELECT,
      })
      return rows.map((r) => mapCategoryRow(r, r._count.items))
    },
    ['library-categories:list', placeId, JSON.stringify(opts)],
    {
      revalidate: CATEGORIES_CACHE_REVALIDATE_SECONDS,
      tags: [categoriesTag(placeId)],
    },
  )()
}

export async function findLibraryCategoryBySlug(
  placeId: string,
  slug: string,
  opts: { includeArchived?: boolean } = {},
): Promise<LibraryCategory | null> {
  return unstable_cache(
    async () => {
      const row = await prisma.libraryCategory.findUnique({
        where: { placeId_slug: { placeId, slug } },
        select: CATEGORY_SELECT,
      })
      if (!row) return null
      if (!opts.includeArchived && row.archivedAt) return null
      return mapCategoryRow(row, row._count.items)
    },
    ['library-categories:by-slug', placeId, slug, JSON.stringify(opts)],
    {
      revalidate: CATEGORIES_CACHE_REVALIDATE_SECONDS,
      tags: [categoriesTag(placeId)],
    },
  )()
}

/** Para admin actions / system events. Acepta archivadas (no las filtra).
 *
 *  Bucket cacheado bajo dos tags:
 *  - `place:<placeId>:library-categories` (set genérico que invalidan las
 *    mutation actions del slice via `revalidateLibraryCategoryPaths`).
 *  - `library-category:<categoryId>` (puntual, por si una mutation futura
 *    quiere invalidar sólo una category sin tirar el set entero).
 *
 *  Como el caller pasa sólo `categoryId`, hacemos un primer lookup mínimo
 *  para extraer el `placeId` y poder taggear correctamente. Es 1 query
 *  extra fuera del bucket cacheado, pero garantiza que las mutations
 *  existentes ya invaliden este helper sin código nuevo en cada action.
 */
export async function findLibraryCategoryById(categoryId: string): Promise<LibraryCategory | null> {
  // Lookup ligero para resolver el placeId (necesario para el tag del set).
  // Retornamos `null` early si la category no existe — saltea el bucket.
  const meta = await prisma.libraryCategory.findUnique({
    where: { id: categoryId },
    select: { placeId: true },
  })
  if (!meta) return null

  return unstable_cache(
    async () => {
      const row = await prisma.libraryCategory.findUnique({
        where: { id: categoryId },
        select: CATEGORY_SELECT,
      })
      if (!row) return null
      return mapCategoryRow(row, row._count.items)
    },
    ['library-categories:by-id', categoryId],
    {
      revalidate: CATEGORIES_CACHE_REVALIDATE_SECONDS,
      tags: [categoriesTag(meta.placeId), `library-category:${categoryId}`],
    },
  )()
}

export async function countLibraryCategories(placeId: string): Promise<number> {
  return unstable_cache(
    async () => {
      return prisma.libraryCategory.count({ where: { placeId, archivedAt: null } })
    },
    ['library-categories:count', placeId],
    {
      revalidate: CATEGORIES_CACHE_REVALIDATE_SECONDS,
      tags: [categoriesTag(placeId)],
    },
  )()
}
