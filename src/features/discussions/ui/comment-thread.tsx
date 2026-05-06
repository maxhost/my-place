import type { QuoteTargetState } from '../domain/types'
import type { CommentView } from '../server/queries'
import type { AggregatedReaction, ReactionAggregationMap } from '../server/reactions-aggregation'
import { reactionMapKey } from '../server/reactions-aggregation'
import type { MentionResolvers } from '@/features/rich-text/public.server'
import { CommentItem } from './comment-item'
import { CommentThreadLive } from './comment-thread-live'
import { CommentComposerForm } from './comment-composer-form'
import { LoadMoreComments } from './load-more-comments'

/**
 * Thread completo (R.6.4 layout): divider + lista (SSR + live wrapper) +
 * load-more + composer.
 *
 * El label "{n} RESPUESTAS" se removió 2026-04-27 (alineado con
 * principio "sin métricas vanidosas" de CLAUDE.md). El divider
 * hairline antes del primer comment ya separa visualmente la zona de
 * comments del contenido del post/evento.
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
  placeId,
  placeSlug,
  viewerUserId,
  viewerIsAdmin,
  items,
  nextCursor,
  reactionsByKey,
  quoteStateByCommentId,
  mentionResolvers,
}: {
  postId: string
  placeId: string
  placeSlug: string
  viewerUserId: string
  viewerIsAdmin: boolean
  items: CommentView[]
  nextCursor: { createdAt: string; id: string } | null
  reactionsByKey: ReactionAggregationMap
  quoteStateByCommentId: Map<string, QuoteTargetState>
  /**
   * Resolvers inyectados por la page consumer — resuelven mentions a su
   * href canónico. La page los construye con `findMember` (slice members)
   * y stubs `null` para event/libraryItem hasta que F.4 los llene.
   */
  mentionResolvers: MentionResolvers
}): React.ReactNode {
  return (
    <section aria-label="Comentarios" className="mt-6">
      <CommentThreadLive
        postId={postId}
        placeSlug={placeSlug}
        viewerUserId={viewerUserId}
        viewerIsAdmin={viewerIsAdmin}
        initialItems={items}
        mentionResolvers={mentionResolvers}
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
                mentionResolvers={mentionResolvers}
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

      <div data-role="comment-composer" className="mx-3 mt-4">
        {/* F.3: composer Lexical (CommentComposer del slice rich-text). */}
        <CommentComposerForm placeId={placeId} postId={postId} />
      </div>
    </section>
  )
}

const EMPTY_REACTIONS: AggregatedReaction[] = []
