import 'server-only'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/db/client'

/**
 * Search liviano de miembros para autocomplete `@user` en composers
 * (F.4 rich-text). Queries `displayName` + `handle` con `ILIKE`,
 * limita a 8 resultados. Cacheado con `unstable_cache` + tag
 * `place-search:${placeId}:members` revalidate 60s.
 *
 * Privacidad: NO incluye email (alineado con `searchMembers` del
 * directorio). Para datasets ≤150 miembros por place, full scan ok.
 */

const SEARCH_REVALIDATE_SECONDS = 60
const MAX_RESULTS = 8

const searchMembersTag = (placeId: string): string => `place-search:${placeId}:members`

export type MentionMember = {
  userId: string
  displayName: string
  handle: string | null
}

export async function searchMembersByPlace(placeId: string, q: string): Promise<MentionMember[]> {
  const trimmed = q.trim()
  return unstable_cache(
    async () => searchMembersInternal(placeId, trimmed),
    ['mention-search-members', placeId, trimmed],
    {
      revalidate: SEARCH_REVALIDATE_SECONDS,
      tags: [searchMembersTag(placeId)],
    },
  )()
}

async function searchMembersInternal(placeId: string, q: string): Promise<MentionMember[]> {
  const where: Record<string, unknown> =
    q.length === 0
      ? {}
      : {
          OR: [
            { displayName: { contains: q, mode: 'insensitive' } },
            { handle: { contains: q, mode: 'insensitive' } },
          ],
        }
  const memberships = await prisma.membership.findMany({
    where: {
      placeId,
      leftAt: null,
      ...(Object.keys(where).length > 0 ? { user: where } : {}),
    },
    take: MAX_RESULTS,
    orderBy: { joinedAt: 'asc' },
    select: {
      userId: true,
      user: { select: { displayName: true, handle: true } },
    },
  })
  return memberships.map((m) => ({
    userId: m.userId,
    displayName: m.user.displayName,
    handle: m.user.handle,
  }))
}
