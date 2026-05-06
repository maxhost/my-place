import type { QuoteTargetState } from '../domain/types'
import type { CommentView } from '../server/queries'
import type { AggregatedReaction } from '../server/reactions-aggregation'
import { MemberAvatar } from '@/features/members/public'
import { richTextExcerpt, type LexicalDocument } from '@/features/rich-text/public'
import { RichTextRenderer, type MentionResolvers } from '@/features/rich-text/public.server'
import { ReactionBar } from './reaction-bar'
import { QuoteButton } from './quote-button'
import { QuotePreview } from './quote-preview'
import { TimeAgo } from '@/shared/ui/time-ago'
import { FlagButton } from '@/features/flags/public'
import { EditWindowActions } from './edit-window-actions'
import { CommentAdminMenu } from './comment-admin-menu'

/**
 * Un comment del thread (R.6.4 layout): avatar 28×28 + author + body + acciones.
 * Sin card chrome — el divider hairline (provisto por el contenedor del thread)
 * separa visualmente. Server Component; delega interactividad a islas client
 * (`ReactionBar`, `QuoteButton`, `EditWindowActions`).
 *
 * Deleted: renderiza placeholder `[mensaje eliminado]`. Se preserva la
 * estructura (avatar + header) para mantener flujo del thread; ocultar el
 * body sin colapsar el slot.
 */
export function CommentItem({
  comment,
  placeSlug: _placeSlug,
  viewerUserId,
  viewerIsAdmin,
  reactions,
  quoteTargetState,
  mentionResolvers,
}: {
  comment: CommentView
  placeSlug: string
  viewerUserId: string
  viewerIsAdmin: boolean
  reactions: AggregatedReaction[]
  quoteTargetState: QuoteTargetState | null
  /**
   * Inyectado por el caller — resuelve mentions a su href canónico. F.3
   * sólo poblará `user` real (via `findMember`); `event` y `libraryItem`
   * pueden retornar null (placeholders del renderer cubren el fallback).
   */
  mentionResolvers: MentionResolvers
}): React.ReactNode {
  const isDeleted = comment.body === null
  const isAuthor = comment.authorUserId !== null && comment.authorUserId === viewerUserId
  // Stable colorKey: si authorUserId fue nulificado por erasure, usar el
  // commentId como fallback — preserva color consistente per-comment sin
  // arrastrar identidad del ex-miembro.
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
          {comment.editedAt ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="italic">(editado)</span>
            </>
          ) : null}
        </header>

        {isDeleted ? (
          <p className="mt-1.5 italic text-muted">[mensaje eliminado]</p>
        ) : (
          <>
            {comment.quotedSnapshot ? (
              <QuotePreview
                snapshot={comment.quotedSnapshot}
                currentState={quoteTargetState ?? 'VISIBLE'}
              />
            ) : null}

            {/* F.3: renderer SSR del slice rich-text (visitor pattern AST → JSX). */}
            <div className="mt-1.5 font-body text-[14.5px] leading-[1.55] text-text">
              <RichTextRenderer document={comment.body} resolvers={mentionResolvers} />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ReactionBar targetType="COMMENT" targetId={comment.id} initial={reactions} />
              <QuoteButton
                commentId={comment.id}
                postId={comment.postId}
                snapshot={{
                  commentId: comment.id,
                  authorLabel: comment.authorSnapshot.displayName,
                  bodyExcerpt: excerptFromBody(comment.body) ?? '',
                  createdAt: comment.createdAt,
                }}
              />
              {!isAuthor ? <FlagButton targetType="COMMENT" targetId={comment.id} /> : null}
              {viewerIsAdmin ? (
                <CommentAdminMenu commentId={comment.id} expectedVersion={comment.version} />
              ) : null}
            </div>

            {isAuthor ? (
              <EditWindowActions
                subject={{
                  kind: 'comment',
                  commentId: comment.id,
                  body: comment.body,
                  createdAt: comment.createdAt,
                  version: comment.version,
                }}
              />
            ) : null}
          </>
        )}
      </div>
    </article>
  )
}

/**
 * Excerpt textual del body Lexical para construir el snapshot de cita al
 * vuelo (sin re-fetch). Si el comment está deletado el body es `null` y
 * no hay excerpt para mostrar.
 */
function excerptFromBody(body: CommentView['body']): string | null {
  if (!body) return null
  return richTextExcerpt(body as LexicalDocument)
}
