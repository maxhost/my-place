'use server'

import { searchEventsByPlace } from '../mention-search'

/**
 * Server Action wrapper de `searchEventsByPlace`. Ver patrón en
 * `members/server/actions/mention-search.ts`.
 */
export async function searchEventsByPlaceAction(
  placeId: string,
  q: string,
): Promise<Array<{ eventId: string; slug: string; title: string }>> {
  return searchEventsByPlace(placeId, q)
}
