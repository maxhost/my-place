import Link from 'next/link'
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
      {/* Banner de "thread de evento": aparece sólo si el Post fue auto-creado
          como conversación de un Event (relación inversa Post.event poblada).
          Linkea al detalle del evento + muestra badge si está cancelado.
          F.E Fase 6 — relación bidireccional Event↔Post.

          El badge "Cancelado" se renderiza inline (no como `<EventCancelledBadge>`
          del slice events) para evitar circular dep:
          discussions/public → post-detail → events/public → events/schemas →
          discussions/public (richTextDocumentSchema). El visual es idéntico al
          badge en events/ui/event-cancelled-badge.tsx. */}
      {post.event ? (
        <div className="flex items-center gap-2 rounded-md border border-place-divider bg-place-card px-3 py-2 text-sm text-place-text-soft">
          <span>Conversación del evento:</span>
          <Link
            href={`/events/${post.event.id}`}
            className="font-medium text-place-text underline hover:text-place-mark-fg"
          >
            {post.event.title}
          </Link>
          {post.event.cancelledAt ? (
            <span
              className="inline-flex items-center rounded border border-place-divider bg-place-card px-2 py-0.5 text-xs italic text-place-text-soft"
              aria-label="Evento cancelado"
            >
              Cancelado
            </span>
          ) : null}
        </div>
      ) : null}

      <header>
        <div className="flex items-start justify-between gap-2">
          <h1 className="font-serif text-3xl text-place-text">{post.title}</h1>
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
        <div className="mt-1 flex items-center gap-2 text-sm text-place-text-soft">
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
        <div className="leading-relaxed text-place-text">
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
