import 'server-only'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/db/client'

/**
 * Search liviano de eventos para autocomplete `/event ` en composers
 * (F.4 rich-text). Filtra por `placeId` + `title ILIKE %q%`. Excluye
 * cancelados (no tiene sentido mencionar un cancelado en otro doc;
 * el snapshot defensivo del renderer los marca igual `[NO DISPONIBLE]`
 * si después se cancelan).
 *
 * Cacheado con `unstable_cache` + tag `place-search:${placeId}:events`
 * revalidate 60s.
 */

const SEARCH_REVALIDATE_SECONDS = 60
const MAX_RESULTS = 8

const searchEventsTag = (placeId: string): string => `place-search:${placeId}:events`

export type MentionEvent = {
  eventId: string
  slug: string
  title: string
}

export async function searchEventsByPlace(placeId: string, q: string): Promise<MentionEvent[]> {
  const trimmed = q.trim()
  return unstable_cache(
    async () => searchEventsInternal(placeId, trimmed),
    ['mention-search-events', placeId, trimmed],
    {
      revalidate: SEARCH_REVALIDATE_SECONDS,
      tags: [searchEventsTag(placeId)],
    },
  )()
}

async function searchEventsInternal(placeId: string, q: string): Promise<MentionEvent[]> {
  const events = await prisma.event.findMany({
    where: {
      placeId,
      cancelledAt: null,
      ...(q.length > 0 ? { title: { contains: q, mode: 'insensitive' } } : {}),
    },
    take: MAX_RESULTS,
    orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      title: true,
      post: { select: { slug: true } },
    },
  })
  return events
    .filter((e): e is typeof e & { post: { slug: string } } => e.post !== null)
    .map((e) => ({ eventId: e.id, slug: e.post.slug, title: e.title }))
}
