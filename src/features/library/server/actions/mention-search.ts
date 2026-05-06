'use server'

import { listCategoriesForMention, searchLibraryItems } from '../mention-search'

/**
 * Server Action wrappers de las queries cacheadas para autocomplete
 * `/library` two-step en composers. Ver patrón en
 * `members/server/actions/mention-search.ts`.
 */

export async function listLibraryCategoriesForMentionAction(
  placeId: string,
): Promise<Array<{ categoryId: string; slug: string; name: string }>> {
  return listCategoriesForMention(placeId)
}

export async function searchLibraryItemsForMentionAction(
  placeId: string,
  categorySlug: string,
  q: string,
): Promise<Array<{ itemId: string; slug: string; title: string }>> {
  return searchLibraryItems(placeId, categorySlug, q)
}
