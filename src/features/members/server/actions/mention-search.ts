'use server'

import { searchMembersByPlace } from '../mention-search'

/**
 * Server Action wrapper de `searchMembersByPlace` para uso desde Client
 * Components (composers de rich-text). Server Action references viajan
 * client-safe; la query subyacente está cacheada con `unstable_cache`.
 */
export async function searchMembersByPlaceAction(
  placeId: string,
  q: string,
): Promise<Array<{ userId: string; displayName: string; handle: string | null }>> {
  return searchMembersByPlace(placeId, q)
}
