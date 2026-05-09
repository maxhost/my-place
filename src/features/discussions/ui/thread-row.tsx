import Link from 'next/link'
import { MemberAvatar } from '@/features/members/public'
import { TimeAgo } from '@/shared/ui/time-ago'
import type { PostListView } from '../domain/types'
import { ReaderStack } from './reader-stack'
import { PostUnreadDot } from './post-unread-dot'
import { isDormant } from '../domain/invariants'

/**
 * Row simple de un thread en la lista (R.6) — usado para todos los
 * posts excepto el primero (que va en `<FeaturedThreadCard>`).
 *
 * Layout (handoff threads/):
 *  - Sin card chrome (no border individual). Padding solo vertical
 *    (14px). El padding lateral (12px) lo aplica el contenedor padre
 *    (`<PostList>` agrega `mx-3` al wrapper `divide-y`) — así los
 *    divider lines respetan el inset 12px sin doblar el padding del
 *    contenido.
 *  - Author row: MemberAvatar 24×24 + nombre + tiempo.
 *  - Título Fraunces 17 con dot unread inline.
 *  - Snippet 1 line clamp.
 *  - Footer: ReaderStack 3 readers (sin contador de respuestas
 *    desde 2026-04-27 — alineado con principio "sin métricas
 *    vanidosas" de CLAUDE.md). Si no hay readers, footer no
 *    renderiza.
 *
 * Full-row tap target via `<Link>`. Posts dormidos opacity reducida.
 *
 * Server Component puro.
 *
 * Ver `docs/features/discussions/spec.md` § 21.1.
 */
export function ThreadRow({ post }: { post: PostListView }): React.ReactNode {
  const dormant = isDormant(post.lastActivityAt, new Date())
  const lastReadMs = post.lastReadAt ? new Date(post.lastReadAt).getTime() : 0
  const hasUnread = new Date(post.lastActivityAt).getTime() > lastReadMs
  const authorUserId = post.authorUserId ?? `ex-${post.id}`
  const readerCount = post.readerSample.length

  return (
    <article className={dormant ? 'opacity-75' : ''}>
      <Link
        href={`/conversations/${post.slug}?from=conversations`}
        className="block py-3.5 focus:outline-none focus-visible:bg-soft"
      >
        <header className="flex items-center gap-2">
          <MemberAvatar
            userId={authorUserId}
            displayName={post.authorSnapshot.displayName}
            avatarUrl={post.authorSnapshot.avatarUrl}
            size={24}
          />
          <span className="font-body text-[13px] font-medium text-text">
            {post.authorSnapshot.displayName}
          </span>
          <span aria-hidden="true" className="text-muted">
            ·
          </span>
          <TimeAgo date={post.lastActivityAt} className="text-[13px] text-muted" />
        </header>
        <h3 className="mt-1.5 flex items-center gap-2 font-title text-[17px] font-semibold leading-snug text-text">
          <span>{post.title}</span>
          {hasUnread ? <PostUnreadDot /> : null}
        </h3>
        {post.snippet ? (
          <p className="mt-0.5 line-clamp-1 font-body text-[13.5px] text-muted">{post.snippet}</p>
        ) : null}
        {readerCount > 0 ? (
          <footer className="mt-2 flex items-center gap-3">
            <ReaderStack readers={post.readerSample} max={3} size={20} />
          </footer>
        ) : null}
      </Link>
    </article>
  )
}
