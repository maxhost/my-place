import type { QuoteTargetState } from '../domain/types'
import type { CommentView } from '../server/queries'
import type { AggregatedReaction, ReactionAggregationMap } from '../server/reactions-aggregation'
import { reactionMapKey } from '../server/reactions-aggregation'
import { CommentItem } from './comment-item'
import { CommentComposer } from './comment-composer'
import { LoadMoreComments } from './load-more-comments'

/**
 * Thread completo: lista inicial (SSR) + load-more (Client) + composer (Client).
 * `quoteStateByCommentId` permite renderizar correctamente los `QuotePreview`
 * de comments que citan a otros que cambiaron de estado (deleted/hidden) desde
 * que se congeló el snapshot original.
 */
export function CommentThread({
  postId,
  placeSlug,
  viewerUserId,
  viewerIsAdmin,
  items,
  nextCursor,
  reactionsByKey,
  quoteStateByCommentId,
}: {
  postId: string
  placeSlug: string
  viewerUserId: string
  viewerIsAdmin: boolean
  items: CommentView[]
  nextCursor: { createdAt: string; id: string } | null
  reactionsByKey: ReactionAggregationMap
  quoteStateByCommentId: Map<string, QuoteTargetState>
}): React.ReactNode {
  return (
    <section aria-label="Comentarios" className="mt-8 space-y-3">
      <h2 className="font-serif text-xl text-place-text-medium">
        {items.length === 0 ? 'Sin comentarios' : 'Comentarios'}
      </h2>

      {items.map((comment) => {
        const reactions =
          reactionsByKey.get(reactionMapKey('COMMENT', comment.id)) ?? EMPTY_REACTIONS
        const quoteTargetState = comment.quotedCommentId
          ? (quoteStateByCommentId.get(comment.quotedCommentId) ?? 'VISIBLE')
          : null
        return (
          <CommentItem
            key={comment.id}
            comment={comment}
            placeSlug={placeSlug}
            viewerUserId={viewerUserId}
            viewerIsAdmin={viewerIsAdmin}
            reactions={reactions}
            quoteTargetState={quoteTargetState}
          />
        )
      })}

      {nextCursor ? (
        <LoadMoreComments
          postId={postId}
          placeSlug={placeSlug}
          viewerUserId={viewerUserId}
          viewerIsAdmin={viewerIsAdmin}
          initialCursor={nextCursor}
        />
      ) : null}

      <div data-role="comment-composer">
        <CommentComposer postId={postId} />
      </div>
    </section>
  )
}

const EMPTY_REACTIONS: AggregatedReaction[] = []
