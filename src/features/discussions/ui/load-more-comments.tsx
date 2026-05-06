'use client'

import { useState, useTransition } from 'react'
import type { CommentView } from '../server/queries'
import type { AggregatedReaction } from '../server/reactions-aggregation'
import { loadMoreCommentsAction } from '../server/actions/load-more'
import type { SerializedCursor } from '../server/actions/load-more'
import { CommentItemClient } from './comment-item-client'
import { friendlyErrorMessage } from './utils'

/**
 * Load-more de comments. Las nuevas páginas NO traen reacciones agregadas —
 * el viewer verá el ReactionBar con counts en cero hasta interactuar; tras la
 * primera reacción el `revalidatePath` refresca el SSR y los counts reales
 * vuelven.
 *
 * Mismo trade-off para `quoteTargetState`: usamos `VISIBLE` como default. Si
 * el target cambió de estado, un reload muestra el estado real.
 */
export function LoadMoreComments({
  postId,
  initialCursor,
}: {
  postId: string
  /** Mantenidos por compat con el call site; el client renderea sin ellos. */
  placeSlug?: string
  viewerUserId?: string
  viewerIsAdmin?: boolean
  initialCursor: SerializedCursor
}): React.ReactNode {
  const [items, setItems] = useState<CommentView[]>([])
  const [cursor, setCursor] = useState<SerializedCursor | null>(initialCursor)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const loadMore = () => {
    if (!cursor) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await loadMoreCommentsAction({ postId, cursor })
        const hydrated = res.items.map(deserializeComment)
        setItems((prev) => [...prev, ...hydrated])
        setCursor(res.nextCursor)
      } catch (err) {
        setError(friendlyErrorMessage(err))
      }
    })
  }

  return (
    <div className="space-y-3">
      {items.map((comment) => (
        <CommentItemClient key={comment.id} comment={comment} reactions={EMPTY_REACTIONS} />
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
          className="w-full rounded-md border border-border bg-surface px-4 py-2 text-sm text-muted hover:text-text disabled:opacity-60"
        >
          {pending ? 'Cargando…' : 'Ver más comentarios'}
        </button>
      ) : null}
    </div>
  )
}

const EMPTY_REACTIONS: AggregatedReaction[] = []

/**
 * Next serializa las Date a strings al cruzar el server-client boundary. Las
 * rehidratamos acá para que los consumidores (TimeAgo, Intl.DateTimeFormat)
 * reciban instancias Date como esperan.
 */
function deserializeComment(comment: CommentView): CommentView {
  return {
    ...comment,
    createdAt: new Date(comment.createdAt),
    editedAt: comment.editedAt ? new Date(comment.editedAt) : null,
    deletedAt: comment.deletedAt ? new Date(comment.deletedAt) : null,
    quotedSnapshot: comment.quotedSnapshot
      ? {
          ...comment.quotedSnapshot,
          createdAt: new Date(comment.quotedSnapshot.createdAt),
        }
      : null,
  }
}
