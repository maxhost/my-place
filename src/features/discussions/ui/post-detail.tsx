import type { Post } from '../domain/types'
import type { AggregatedReaction } from '../server/reactions-aggregation'
import { RichTextRenderer } from './rich-text-renderer'
import { ReactionBar } from './reaction-bar'
import { TimeAgo } from '@/shared/ui/time-ago'
import { FlagButton } from '@/features/flags/public'
import { EditWindowActions } from './edit-window-actions'
import { PostAdminMenu } from './post-admin-menu'

/**
 * Header + body del post. El author/fecha aparecen como metadato tenue; el
 * título es H1 de la página. Si el viewer es autor y la ventana 60s sigue
 * abierta, se ofrece editar/eliminar inline. Admin ve un kebab con
 * Ocultar/Mostrar + Eliminar — independiente de la ventana.
 */
export function PostDetail({
  post,
  viewerUserId,
  viewerIsAdmin,
  placeSlug,
  reactions,
}: {
  post: Post
  viewerUserId: string
  viewerIsAdmin: boolean
  placeSlug: string
  reactions: AggregatedReaction[]
}): React.ReactNode {
  const isAuthor = post.authorUserId !== null && post.authorUserId === viewerUserId

  return (
    <article className="space-y-4">
      {/* F.F: cuando el Post es thread de un evento, el banner / metadata
          completos se renderizan arriba via `EventMetadataHeader` desde el
          page composer (`conversations/[postSlug]/page.tsx`). PostDetail
          intencionalmente NO duplica esa UI — el evento ES el thread y el
          header del evento es la cara visible canónica. */}

      <header>
        <div className="flex items-start justify-between gap-2">
          <h1 className="font-serif text-3xl text-text">{post.title}</h1>
          <div className="flex items-center gap-1">
            {!isAuthor ? <FlagButton targetType="POST" targetId={post.id} /> : null}
            {viewerIsAdmin ? (
              <PostAdminMenu
                postId={post.id}
                hiddenAt={post.hiddenAt}
                expectedVersion={post.version}
              />
            ) : null}
          </div>
        </div>
        {post.hiddenAt ? (
          <p className="mt-1 inline-block rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
            Oculto — sólo admins lo ven
          </p>
        ) : null}
        <div className="mt-1 flex items-center gap-2 text-sm text-muted">
          <span>{post.authorSnapshot.displayName}</span>
          <span aria-hidden="true">·</span>
          <TimeAgo date={post.createdAt} />
          {post.editedAt ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="italic">(editado)</span>
            </>
          ) : null}
        </div>
      </header>

      {post.body ? (
        <div className="leading-relaxed text-text">
          <RichTextRenderer doc={post.body} placeSlug={placeSlug} />
        </div>
      ) : null}

      <ReactionBar targetType="POST" targetId={post.id} initial={reactions} />

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
