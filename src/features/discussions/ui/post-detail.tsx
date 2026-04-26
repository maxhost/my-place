import type { Post } from '../domain/types'
import type { AggregatedReaction } from '../server/reactions-aggregation'
import { RichTextRenderer } from './rich-text-renderer'
import { ReactionBar } from './reaction-bar'
import { TimeAgo } from '@/shared/ui/time-ago'
import { FlagButton } from '@/features/flags/public'
import { EditWindowActions } from './edit-window-actions'

/**
 * Header + body del post (R.6.4 layout). El kebab admin (`<PostAdminMenu>`)
 * se renderiza arriba en el `<ThreadHeaderBar>` (slot derecho) compuesto por
 * la page; PostDetail intencionalmente NO lo monta para evitar duplicado.
 *
 * Author row + título Fraunces 28 + body. Si el viewer es autor y la ventana
 * 60s sigue abierta, se ofrecen acciones inline de editar/eliminar. Flag
 * button visible para non-author.
 */
export function PostDetail({
  post,
  viewerUserId,
  placeSlug,
  reactions,
}: {
  post: Post
  viewerUserId: string
  placeSlug: string
  reactions: AggregatedReaction[]
}): React.ReactNode {
  const isAuthor = post.authorUserId !== null && post.authorUserId === viewerUserId

  return (
    <article className="space-y-4 px-3 pt-4">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="font-medium text-text">{post.authorSnapshot.displayName}</span>
          <span aria-hidden="true">·</span>
          <TimeAgo date={post.createdAt} />
          {post.editedAt ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="italic">(editado)</span>
            </>
          ) : null}
        </div>
        <h1 className="font-title text-[28px] font-bold leading-tight text-text">{post.title}</h1>
        {post.hiddenAt ? (
          <p className="inline-block rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
            Oculto — sólo admins lo ven
          </p>
        ) : null}
      </header>

      {post.body ? (
        <div className="font-body text-[15.5px] leading-[1.65] text-text">
          <RichTextRenderer doc={post.body} placeSlug={placeSlug} />
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <ReactionBar targetType="POST" targetId={post.id} initial={reactions} />
        {!isAuthor ? <FlagButton targetType="POST" targetId={post.id} /> : null}
      </div>

      {isAuthor ? (
        <EditWindowActions
          subject={{
            kind: 'post',
            postId: post.id,
            title: post.title,
            body: post.body,
            createdAt: post.createdAt,
            version: post.version,
            placeSlug,
          }}
        />
      ) : null}
    </article>
  )
}
