import type { QuoteSnapshot, QuoteTargetState } from '../domain/types'
import { formatAbsoluteTime } from '@/shared/lib/format-date'

/**
 * Preview de un comment citado (R.6.4 visual): border-left 2px accent
 * + texto italic muted. Congelado al momento de responder, pero la UI
 * puede ajustar el body según `currentState`:
 *  - VISIBLE ⇒ render el excerpt del snapshot.
 *  - DELETED ⇒ `[mensaje eliminado]` (autor/fecha del snapshot persisten).
 */
export function QuotePreview({
  snapshot,
  currentState,
  onRemove,
}: {
  snapshot: QuoteSnapshot
  currentState: QuoteTargetState
  onRemove?: React.ReactNode
}) {
  const body = currentState === 'DELETED' ? '[mensaje eliminado]' : snapshot.bodyExcerpt

  return (
    <div className="my-2 border-l-2 border-accent pl-3 text-[13.5px]">
      <div className="mb-0.5 flex items-center justify-between gap-2 text-xs text-muted">
        <span>
          <span className="font-medium text-muted">{snapshot.authorLabel}</span>
          <span className="mx-1">·</span>
          <time dateTime={new Date(snapshot.createdAt).toISOString()}>
            {formatAbsoluteTime(snapshot.createdAt)}
          </time>
        </span>
        {onRemove}
      </div>
      <p className="whitespace-pre-wrap italic text-muted">{body}</p>
    </div>
  )
}
