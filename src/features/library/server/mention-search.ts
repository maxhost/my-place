import 'server-only'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/db/client'

/**
 * Search liviano para autocomplete `/library` (composers F.4 rich-text).
 *
 * Two-step:
 *  1. `listCategoriesForMention(placeId)` — categorías del place activas.
 *  2. `searchLibraryItems(placeId, categorySlug, q)` — items dentro de esa
 *     categoría con filtro por título.
 *
 * Cada uno cacheado con `unstable_cache` + tag
 * `place-search:${placeId}:library` revalidate 60s. Misma key sirve a
 * ambas queries — refresh global cuando cambia categorías o items.
 */

const SEARCH_REVALIDATE_SECONDS = 60
const MAX_CATEGORIES = 50
const MAX_ITEMS = 8

const searchLibraryTag = (placeId: string): string => `place-search:${placeId}:library`

export type MentionLibraryCategory = {
  categoryId: string
  slug: string
  name: string
}

export type MentionLibraryItem = {
  itemId: string
  slug: string
  title: string
}

export async function listCategoriesForMention(placeId: string): Promise<MentionLibraryCategory[]> {
  return unstable_cache(
    async () => listCategoriesInternal(placeId),
    ['mention-list-library-categories', placeId],
    {
      revalidate: SEARCH_REVALIDATE_SECONDS,
      tags: [searchLibraryTag(placeId)],
    },
  )()
}

async function listCategoriesInternal(placeId: string): Promise<MentionLibraryCategory[]> {
  const cats = await prisma.libraryCategory.findMany({
    where: { placeId, archivedAt: null },
    take: MAX_CATEGORIES,
    orderBy: [{ position: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    select: { id: true, slug: true, title: true },
  })
  return cats.map((c) => ({ categoryId: c.id, slug: c.slug, name: c.title }))
}

export async function searchLibraryItems(
  placeId: string,
  categorySlug: string,
  q: string,
): Promise<MentionLibraryItem[]> {
  const trimmed = q.trim()
  return unstable_cache(
    async () => searchItemsInternal(placeId, categorySlug, trimmed),
    ['mention-search-library-items', placeId, categorySlug, trimmed],
    {
      revalidate: SEARCH_REVALIDATE_SECONDS,
      tags: [searchLibraryTag(placeId)],
    },
  )()
}

async function searchItemsInternal(
  placeId: string,
  categorySlug: string,
  q: string,
): Promise<MentionLibraryItem[]> {
  const items = await prisma.libraryItem.findMany({
    where: {
      placeId,
      archivedAt: null,
      category: { slug: categorySlug, placeId },
      ...(q.length > 0 ? { post: { title: { contains: q, mode: 'insensitive' } } } : {}),
    },
    take: MAX_ITEMS,
    orderBy: [{ id: 'asc' }],
    select: {
      id: true,
      post: { select: { slug: true, title: true } },
    },
  })
  return items
    .filter((i): i is typeof i & { post: { slug: string; title: string } } => i.post !== null)
    .map((i) => ({ itemId: i.id, slug: i.post.slug, title: i.post.title }))
}
