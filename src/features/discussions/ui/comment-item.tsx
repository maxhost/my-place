import type { QuoteTargetState } from '../domain/types'
import type { CommentView } from '../server/queries'
import type { AggregatedReaction } from '../server/reactions-aggregation'
import { RichTextRenderer } from './rich-text-renderer'
import { ReactionBar } from './reaction-bar'
import { QuoteButton } from './quote-button'
import { QuotePreview } from './quote-preview'
import { TimeAgo } from '@/shared/ui/time-ago'
import { FlagButton } from '@/features/flags/public'
import { EditWindowActions } from './edit-window-actions'
import { CommentAdminMenu } from './comment-admin-menu'

/**
 * Un comment del thread. Server Component — sin `'use client'`. Delega toda la
 * interactividad a islas client (`ReactionBar`, `QuoteButton`, `EditWindowActions`).
 *
 * Deleted: renderiza placeholder `[mensaje eliminado]`. No se muestra el quote ni
 * las reacciones — el comment "borrado" deja su huella estructural en el thread
 * (mantiene la posición y el flujo de respuestas) pero sin contenido.
 */
export function CommentItem({
  comment,
  placeSlug,
  viewerUserId,
  viewerIsAdmin,
  reactions,
  quoteTargetState,
}: {
  comment: CommentView
  placeSlug: string
  viewerUserId: string
  viewerIsAdmin: boolean
  reactions: AggregatedReaction[]
  quoteTargetState: QuoteTargetState | null
}): React.ReactNode {
  const isDeleted = comment.body === null
  const isAuthor = comment.authorUserId !== null && comment.authorUserId === viewerUserId

  return (
    <article
      className="rounded-lg border border-border bg-surface p-4"
      data-comment-id={comment.id}
    >
      <header className="flex items-center gap-2 text-xs text-muted">
        <span className="font-medium text-muted">{comment.authorSnapshot.displayName}</span>
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
        <p className="mt-2 italic text-muted">[mensaje eliminado]</p>
      ) : (
        <>
          {comment.quotedSnapshot ? (
            <QuotePreview
              snapshot={comment.quotedSnapshot}
              currentState={quoteTargetState ?? 'VISIBLE'}
            />
          ) : null}

          <div className="mt-2 text-text">
            <RichTextRenderer
              doc={comment.body as NonNullable<typeof comment.body>}
              placeSlug={placeSlug}
            />
          </div>

          <div className="mt-2 flex items-center gap-3">
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
                body: comment.body as NonNullable<typeof comment.body>,
                createdAt: comment.createdAt,
                version: comment.version,
              }}
            />
          ) : null}
        </>
      )}
    </article>
  )
}

/**
 * Excerpt textual del comment para construir un `QuoteSnapshot` al vuelo.
 * La fuente canónica sigue siendo `richTextExcerpt` (invocado server-side al
 * crear el comment citante); esto es sólo para alimentar el botón de "citar".
 */
function excerptFromBody(body: CommentView['body']): string | null {
  if (!body) return null
  const parts: string[] = []
  const walk = (nodes: unknown[]) => {
    for (const node of nodes) {
      const n = node as { type: string; text?: string; content?: unknown[] }
      if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text)
      else if (Array.isArray(n.content)) walk(n.content)
    }
  }
  walk(body.content)
  const joined = parts.join(' ').trim()
  if (joined.length <= 200) return joined
  return `${joined.slice(0, 197).trimEnd()}…`
}
