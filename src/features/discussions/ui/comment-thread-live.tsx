'use client'

import type { ReactNode } from 'react'
import type { CommentView } from '../server/queries'
import type { AggregatedReaction } from '../server/reactions-aggregation'
import { CommentItemClient } from './comment-item-client'
import { useCommentRealtime } from './use-comment-realtime'

/**
 * Wrapper client-side del thread: renderiza los items SSR como `children` y
 * appendea comments nuevos recibidos por `comment_created` broadcast (ver
 * `use-comment-realtime.ts` + `server/realtime.ts`).
 *
 * Los comments appendeados muestran `reactions=[]` y `quoteTargetState`
 * default — mismo trade-off que `LoadMoreComments`: el próximo
 * `revalidatePath` trae counts reales via SSR. El mapeo de reacciones en
 * streaming sería un PR aparte.
 *
 * Render de SSR (`children`) NO se re-renderiza en el cliente: el wrapper
 * solo coloca los nuevos debajo. Esto preserva reacciones ya agregadas +
 * estado de citas congelado.
 */
export function CommentThreadLive({
  postId,
  initialItems,
  children,
}: {
  postId: string
  /** Mantenidos en la firma por compat con el call site; usados por el hook. */
  placeSlug: string
  viewerUserId: string
  viewerIsAdmin: boolean
  initialItems: CommentView[]
  /** mentionResolvers no se pasa al cliente: el client renderer pinta mention.label snapshot. */
  mentionResolvers?: unknown
  children: ReactNode
}): React.ReactNode {
  const { appendedComments } = useCommentRealtime({ postId, initialItems })

  return (
    <>
      {children}
      {appendedComments.map((comment) => (
        <CommentItemClient key={comment.id} comment={comment} reactions={EMPTY_REACTIONS} />
      ))}
    </>
  )
}

const EMPTY_REACTIONS: AggregatedReaction[] = []
