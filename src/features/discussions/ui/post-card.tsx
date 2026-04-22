import Link from 'next/link'
import type { PostListView } from '../domain/types'
import { isDormant } from '../domain/invariants'
import { PostUnreadDot } from './post-unread-dot'
import { TimeAgo } from '@/shared/ui/time-ago'

/**
 * Preview de post en la lista. El título es link canónico a `/conversations/{slug}`.
 * Posts "dormidos" (sin actividad ≥ 30 días) se renderizan con tipografía
 * atenuada — señal visual, no texto — consistente con el principio "nada
 * parpadea, nada grita".
 *
 * Dot de novedad: aparece cuando `lastActivityAt > (lastReadAt ?? 0)`. Es
 * binario — sin contador. La lectura se materializa con dwell ≥ 5s en el
 * thread (ver `DwellTracker`).
 */
export function PostCard({ post }: { post: PostListView }): React.ReactNode {
  const dormant = isDormant(post.lastActivityAt, new Date())
  const lastReadMs = post.lastReadAt ? new Date(post.lastReadAt).getTime() : 0
  const hasUnread = new Date(post.lastActivityAt).getTime() > lastReadMs

  return (
    <article
      className={`rounded-lg border border-place-divider bg-place-card p-4 transition ${
        dormant ? 'opacity-75' : ''
      }`}
    >
      <Link
        href={`/conversations/${post.slug}`}
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-place-mark-fg"
      >
        <h3
          className={`flex items-center gap-2 font-serif text-xl ${
            dormant ? 'text-place-text-medium' : 'text-place-text'
          }`}
        >
          <span>{post.title}</span>
          {hasUnread ? <PostUnreadDot /> : null}
        </h3>
      </Link>
      <div className="mt-2 flex items-center gap-2 text-xs text-place-text-soft">
        <span>{post.authorSnapshot.displayName}</span>
        <span aria-hidden="true">·</span>
        <TimeAgo date={post.lastActivityAt} />
        {post.hiddenAt ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="rounded bg-place-mark-bg px-1 text-place-mark-fg">oculto</span>
          </>
        ) : null}
      </div>
    </article>
  )
}
