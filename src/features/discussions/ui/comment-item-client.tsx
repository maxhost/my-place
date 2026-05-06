'use client'

import type { ReactNode } from 'react'
import type { CommentView } from '../server/queries'
import type { AggregatedReaction } from '../server/reactions-aggregation'
import { MemberAvatar } from '@/features/members/public'
import {
  RichTextRendererClient,
  richTextExcerpt,
  type LexicalDocument,
} from '@/features/rich-text/public'
import { ReactionBar } from './reaction-bar'
import { QuoteButton } from './quote-button'
import { TimeAgo } from '@/shared/ui/time-ago'
import { FlagButton } from '@/features/flags/public'

/**
 * Variant client del `<CommentItem>`. Usado por `<CommentThreadLive>` para
 * appendear comments que llegan por broadcast realtime. Equivalente al
 * server `<CommentItem>` excepto:
 *  - usa `<RichTextRendererClient>` (sin queries — sólo snapshot labels en
 *    mentions; el próximo `revalidatePath` re-render via SSR los enriquece).
 *  - omite `<QuotePreview>` (un comment recién creado no tiene cita
 *    consolidada en este path realtime — el SSR la traerá).
 *  - omite `<EditWindowActions>` y admin menu (el realtime es siempre
 *    de comments de OTROS usuarios — el autor ve el suyo via revalidate).
 */
export function CommentItemClient({
  comment,
  reactions,
}: {
  comment: CommentView
  reactions: AggregatedReaction[]
}): ReactNode {
  const isDeleted = comment.body === null
  const colorKey = comment.authorUserId ?? comment.id

  return (
    <article className="flex gap-3 py-3" data-comment-id={comment.id}>
      <div className="shrink-0 pt-0.5">
        <MemberAvatar
          userId={colorKey}
          displayName={comment.authorSnapshot.displayName}
          avatarUrl={comment.authorSnapshot.avatarUrl}
          size={28}
        />
      </div>
      <div className="min-w-0 flex-1">
        <header className="flex items-center gap-2 text-[13px] text-muted">
          <span className="font-medium text-text">{comment.authorSnapshot.displayName}</span>
          <span aria-hidden="true">·</span>
          <TimeAgo date={comment.createdAt} />
        </header>

        {isDeleted ? (
          <p className="mt-1.5 italic text-muted">[mensaje eliminado]</p>
        ) : (
          <>
            <div className="mt-1.5 font-body text-[14.5px] leading-[1.55] text-text">
              <RichTextRendererClient document={comment.body} />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ReactionBar targetType="COMMENT" targetId={comment.id} initial={reactions} />
              <QuoteButton
                commentId={comment.id}
                postId={comment.postId}
                snapshot={{
                  commentId: comment.id,
                  authorLabel: comment.authorSnapshot.displayName,
                  bodyExcerpt: comment.body ? richTextExcerpt(comment.body as LexicalDocument) : '',
                  createdAt: comment.createdAt,
                }}
              />
              <FlagButton targetType="COMMENT" targetId={comment.id} />
            </div>
          </>
        )}
      </div>
    </article>
  )
}
