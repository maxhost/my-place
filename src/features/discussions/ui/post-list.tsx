import type { PostListFilter } from '../domain/filter'
import type { PostListView } from '../domain/types'
import { ThreadsSectionHeader } from './threads-section-header'
import { ThreadFilterPills } from './thread-filter-pills'
import { FeaturedThreadCard } from './featured-thread-card'
import { ThreadRow } from './thread-row'
import { EmptyThreads } from './empty-threads'
import { LoadMorePosts } from './load-more-posts'

/**
 * Lista de discusiones del place (R.6 rediseño).
 *
 * Composición top-down:
 *  - `<ThreadsSectionHeader>` — chip 💬 + título "Discusiones" + CTA "Nueva".
 *  - `<ThreadFilterPills>` — Todos / Sin respuesta / En los que participo.
 *    Solo "Todos" funcional en R.6 (otros 2 disabled).
 *  - Si la lista está vacía → `<EmptyThreads>` y stop.
 *  - Si hay items: el primero como `<FeaturedThreadCard>` (bento con
 *    border + padding 18) seguido del resto como `<ThreadRow>`s
 *    apilados con hairline divider entre rows.
 *  - `<LoadMorePosts>` para paginación cursor-based si hay nextCursor.
 *
 * El nombre del export es `PostList` (NO `ThreadList`) para
 * preservar consumers existentes — el slice se llama `discussions` y
 * el modelo se sigue llamando `Post` (vocabulario R.6 "thread" es solo
 * UI-facing).
 *
 * Ver `docs/features/discussions/spec.md` § 21.1.
 */
export function PostList({
  placeId,
  items,
  nextCursor,
  filter = 'all',
}: {
  placeId: string
  items: PostListView[]
  nextCursor: { createdAt: string; id: string } | null
  filter?: PostListFilter
}): React.ReactNode {
  // Featured = primer post según lo marcado por listPostsByPlace
  // (heurística: idx===0 && !cursor). Después del primero, todo va como
  // ThreadRow apilado con hairline.
  const featured = items[0] ?? null
  const rest = items.slice(1)

  return (
    <section aria-label="Lista de discusiones" className="flex flex-col gap-4 pb-6">
      <ThreadsSectionHeader />
      <ThreadFilterPills />
      {items.length === 0 ? (
        <EmptyThreads filter={filter} />
      ) : (
        <>
          {featured ? <FeaturedThreadCard post={featured} /> : null}
          {rest.length > 0 ? (
            <div className="mx-3 divide-y divide-border border-y-[0.5px] border-border">
              {rest.map((post) => (
                <ThreadRow key={post.id} post={post} />
              ))}
            </div>
          ) : null}
          {nextCursor ? (
            <LoadMorePosts placeId={placeId} initialCursor={nextCursor} filter={filter} />
          ) : null}
        </>
      )}
    </section>
  )
}
