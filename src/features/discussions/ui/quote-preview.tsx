import type { QuoteSnapshot, QuoteTargetState } from '../domain/types'
import { formatAbsoluteTime } from '@/shared/lib/format-date'

/**
 * Preview de un comment citado. Congelado al momento de responder, pero la UI
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
    <div className="bg-place-mark-bg/40 my-2 rounded border-l-4 border-place-mark-fg p-3 text-sm">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-place-text-soft">
        <span>
          <span className="font-medium text-place-text-medium">{snapshot.authorLabel}</span>
          <span className="mx-1">·</span>
          <time dateTime={new Date(snapshot.createdAt).toISOString()}>
            {formatAbsoluteTime(snapshot.createdAt)}
          </time>
        </span>
        {onRemove}
      </div>
      <p className="whitespace-pre-wrap text-place-text-medium">{body}</p>
    </div>
  )
}
