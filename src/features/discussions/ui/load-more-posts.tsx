'use client'

import { useState, useTransition } from 'react'
import type { PostListView } from '../domain/types'
import { loadMorePostsAction } from '../server/actions/load-more'
import type { SerializedCursor } from '../server/actions/load-more'
import { PostCard } from './post-card'
import { friendlyErrorMessage } from './utils'

export function LoadMorePosts({
  placeId,
  initialCursor,
}: {
  placeId: string
  initialCursor: SerializedCursor
}): React.ReactNode {
  const [items, setItems] = useState<PostListView[]>([])
  const [cursor, setCursor] = useState<SerializedCursor | null>(initialCursor)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const loadMore = () => {
    if (!cursor) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await loadMorePostsAction({ placeId, cursor })
        setItems((prev) => [...prev, ...res.items])
        setCursor(res.nextCursor)
      } catch (err) {
        setError(friendlyErrorMessage(err))
      }
    })
  }

  return (
    <div className="space-y-3">
      {items.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
      {error ? (
        <p role="alert" aria-live="polite" className="text-sm text-amber-700">
          {error}
        </p>
      ) : null}
      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          className="w-full rounded-md border border-place-divider bg-place-card px-4 py-2 text-sm text-place-text-soft hover:text-place-text disabled:opacity-60"
        >
          {pending ? 'Cargando…' : 'Ver más conversaciones'}
        </button>
      ) : null}
    </div>
  )
}
