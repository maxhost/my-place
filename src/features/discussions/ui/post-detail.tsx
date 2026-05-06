import Link from 'next/link'
import { MemberAvatar } from '@/features/members/public'
import type { Post } from '../domain/types'
import type { AggregatedReaction } from '../server/reactions-aggregation'
import { ReactionBar } from './reaction-bar'
import { TimeAgo } from '@/shared/ui/time-ago'
import { FlagButton } from '@/features/flags/public'
import { EditWindowActions } from './edit-window-actions'

/**
 * Header + body del post (R.6.4 layout, ajustado 2026-04-27).
 *
 * Orden visual:
 *  - h1 título (Fraunces 28).
 *  - Body con RichTextRenderer.
 *  - **AuthorRow al fondo** del post (avatar + nombre + tiempo) —
 *    movido desde arriba del título por feedback visual. Mismo
 *    patrón que `<OrganizerRow>` en event-threads: identidad
 *    contextual al final del contenido, no titular.
 *  - ReactionBar + FlagButton.
 *  - EditWindowActions inline (autor + ventana 60s abierta).
 *
 * El kebab admin (`<PostAdminMenu>`) vive en el `<ThreadHeaderBar>`
 * (slot derecho) compuesto por la page; PostDetail intencionalmente
 * NO lo monta para evitar duplicado.
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
        <h1 className="font-title text-[28px] font-bold leading-tight text-text">{post.title}</h1>
        {post.hiddenAt ? (
          <p className="inline-block rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
            Oculto — sólo admins lo ven
          </p>
        ) : null}
      </header>

      {/* stub F.1: el RichTextRenderer (TipTap) se reemplaza en F.4 por el
          renderer SSR de Lexical. */}
      {post.body ? (
        <div className="font-body text-[15.5px] leading-[1.65] text-text">
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            Contenido temporalmente deshabilitado durante migración a Lexical (F.1). Se restaura en
            F.4.
          </div>
        </div>
      ) : null}

      <AuthorRow post={post} />

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

/**
 * Fila de autor al pie del post: avatar 28×28 + nombre + tiempo
 * relativo + (editado) opcional. Defensive: ex-miembro
 * (authorUserId null tras erasure 365d) → div no-link, avatar usa
 * colorKey fallback `ex-${postId}`.
 *
 * Mismo patrón visual que `<OrganizerRow>` en `<EventMetadataHeader>`
 * — identidad al final del contenido, silenciosa pero accesible.
 */
function AuthorRow({ post }: { post: Post }): React.ReactNode {
  const isExMember = post.authorUserId === null
  const colorKey = post.authorUserId ?? `ex-${post.id}`

  const inner = (
    <>
      <MemberAvatar
        userId={colorKey}
        displayName={post.authorSnapshot.displayName}
        avatarUrl={post.authorSnapshot.avatarUrl}
        size={28}
      />
      <span className="text-sm text-muted">
        <span className="font-medium text-text">{post.authorSnapshot.displayName}</span>
        <span aria-hidden="true"> · </span>
        <TimeAgo date={post.createdAt} />
        {post.editedAt ? (
          <>
            <span aria-hidden="true"> · </span>
            <span className="italic">(editado)</span>
          </>
        ) : null}
      </span>
    </>
  )

  if (isExMember) {
    return <div className="flex items-center gap-2.5">{inner}</div>
  }

  return (
    <Link
      href={`/m/${post.authorUserId}`}
      className="flex items-center gap-2.5 hover:opacity-80 motion-safe:transition-opacity"
    >
      {inner}
    </Link>
  )
}
