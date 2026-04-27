import type { QuoteTargetState } from '../domain/types'
import type { CommentView } from '../server/queries'
import type { AggregatedReaction, ReactionAggregationMap } from '../server/reactions-aggregation'
import { reactionMapKey } from '../server/reactions-aggregation'
import { CommentItem } from './comment-item'
import { CommentComposer } from './comment-composer'
import { CommentThreadLive } from './comment-thread-live'
import { LoadMoreComments } from './load-more-comments'

/**
 * Thread completo (R.6.4 layout): divider + label "{n} respuestas" caps +
 * lista (SSR + live wrapper) + load-more + composer.
 *
 * El composer ahora es sticky bottom (`<CommentComposer>` se posiciona
 * `fixed`); por eso se monta FUERA de la sección scrollable. Ver
 * comment-composer.tsx.
 *
 * `quoteStateByCommentId` permite renderizar correctamente los
 * `QuotePreview` de comments que citan a otros que cambiaron de estado
 * (deleted/hidden) desde que se congeló el snapshot.
 *
 * `CommentThreadLive` envuelve los items SSR — appendea comments que llegan
 * por broadcast `comment_created` sin re-render del SSR original. Ver
 * `use-comment-realtime.ts`.
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
    <section aria-label="Comentarios" className="mt-6">
      <div className="mx-3 border-t-[0.5px] border-border py-3">
        <span className="font-body text-[11px] font-semibold tracking-[0.06em] text-muted">
          {items.length} {items.length === 1 ? 'RESPUESTA' : 'RESPUESTAS'}
        </span>
      </div>

      <CommentThreadLive
        postId={postId}
        placeSlug={placeSlug}
        viewerUserId={viewerUserId}
        viewerIsAdmin={viewerIsAdmin}
        initialItems={items}
      >
        <div className="mx-3 divide-y divide-border border-t-[0.5px] border-border">
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
        </div>
      </CommentThreadLive>

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
