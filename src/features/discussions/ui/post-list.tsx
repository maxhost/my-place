import type { PostListView } from '../domain/types'
import { PostCard } from './post-card'
import { LoadMorePosts } from './load-more-posts'

/**
 * Lista de posts del place. Renderiza la primera página server-side con
 * `PostCard`; si hay `nextCursor`, monta el Client Component `<LoadMorePosts>`
 * para extender la lista sin navegar.
 */
export function PostList({
  placeId,
  items,
  nextCursor,
}: {
  placeId: string
  items: PostListView[]
  nextCursor: { createdAt: string; id: string } | null
}): React.ReactNode {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
        Todavía no hay conversaciones. Arrancá vos la primera.
      </div>
    )
  }

  return (
    <section aria-label="Lista de conversaciones" className="space-y-3">
      {items.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
      {nextCursor ? <LoadMorePosts placeId={placeId} initialCursor={nextCursor} /> : null}
    </section>
  )
}
