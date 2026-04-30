'use client'

import { useState, useTransition } from 'react'
import type { PostListFilter } from '../domain/filter'
import type { PostListView } from '../domain/types'
import { loadMorePostsAction } from '../server/actions/load-more'
import type { SerializedCursor } from '../server/actions/load-more'
import { ThreadRow } from './thread-row'
import { friendlyErrorMessage } from './utils'

export function LoadMorePosts({
  placeId,
  initialCursor,
  filter = 'all',
}: {
  placeId: string
  initialCursor: SerializedCursor
  filter?: PostListFilter
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
        // Filter activo se propaga en cada page para que la paginación
        // siga el mismo conjunto filtrado. Sin esto, page 2 mostraría
        // posts que no matchean el filter de page 1.
        const res = await loadMorePostsAction({ placeId, cursor, filter })
        setItems((prev) => [...prev, ...res.items])
        setCursor(res.nextCursor)
      } catch (err) {
        setError(friendlyErrorMessage(err))
      }
    })
  }

  return (
    <div>
      {items.length > 0 ? (
        <div className="divide-y divide-border border-y-[0.5px] border-border">
          {items.map((post) => (
            <ThreadRow key={post.id} post={post} />
          ))}
        </div>
      ) : null}
      {error ? (
        <p role="alert" aria-live="polite" className="px-3 pt-2 text-sm text-amber-700">
          {error}
        </p>
      ) : null}
      {cursor ? (
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={loadMore}
            disabled={pending}
            className="w-full rounded-[10px] border-[0.5px] border-border bg-surface px-4 py-2 text-sm text-muted hover:text-text disabled:opacity-60 motion-safe:transition-colors"
          >
            {pending ? 'Cargando…' : 'Ver más discusiones'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
