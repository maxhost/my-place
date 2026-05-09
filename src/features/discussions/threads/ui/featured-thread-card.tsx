import Link from 'next/link'
import { MemberAvatar } from '@/features/members/public'
import { TimeAgo } from '@/shared/ui/time-ago'
import type { PostListView } from '@/features/discussions/domain/types'
import { ReaderStack } from '@/features/discussions/presence/public'
import { PostUnreadDot } from '@/features/discussions/presence/public'
import { isDormant } from '@/features/discussions/domain/invariants'

/**
 * Card "featured" del primer thread por `lastActivityAt` (R.6).
 *
 * Layout (handoff threads/):
 *  - bg-surface, border-[0.5px] border-border, rounded-[18px], p-[18px].
 *  - Author row: MemberAvatar 24×24 + nombre + tiempo relativo.
 *  - Título Fraunces 22 con dot unread inline si aplica.
 *  - Snippet 2 lines clamp.
 *  - Footer: ReaderStack 4 readers (sin contador de respuestas
 *    desde 2026-04-27 — alineado con principio "sin métricas
 *    vanidosas" de CLAUDE.md).
 *
 * Click → navegación al thread. Posts dormidos (≥30 días sin actividad)
 * con opacity reducida — señal visual sin grito.
 *
 * Server Component puro. La lógica `isDormant` viene de invariants.
 *
 * Ver `docs/features/discussions/spec.md` § 21.1.
 */
export function FeaturedThreadCard({ post }: { post: PostListView }): React.ReactNode {
  const dormant = isDormant(post.lastActivityAt, new Date())
  const lastReadMs = post.lastReadAt ? new Date(post.lastReadAt).getTime() : 0
  const hasUnread = new Date(post.lastActivityAt).getTime() > lastReadMs
  const authorUserId = post.authorUserId ?? `ex-${post.id}`

  return (
    <article
      className={[
        'mx-3 rounded-[18px] border-[0.5px] border-border bg-surface p-[18px]',
        dormant ? 'opacity-75' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Link
        href={`/conversations/${post.slug}?from=conversations`}
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-bg"
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
        <h2 className="mt-3 flex items-center gap-2 font-title text-[22px] font-bold leading-tight text-text">
          <span>{post.title}</span>
          {hasUnread ? <PostUnreadDot /> : null}
        </h2>
        {post.snippet ? (
          <p className="mt-1.5 line-clamp-2 font-body text-sm leading-snug text-muted">
            {post.snippet}
          </p>
        ) : null}
      </Link>
      {post.readerSample.length > 0 ? (
        <footer className="mt-3 flex items-center gap-3">
          <ReaderStack readers={post.readerSample} max={4} size={22} />
        </footer>
      ) : null}
    </article>
  )
}
