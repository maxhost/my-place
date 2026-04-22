'use client'

import type { QuoteSnapshot } from '../domain/types'
import { useQuoteStore } from './quote-store'

/**
 * Botón "Citar" por cada comment. Empuja al store `{commentId, postId, snapshot}`
 * y hace scroll al composer al pie del thread.
 */
export function QuoteButton({
  commentId,
  postId,
  snapshot,
}: {
  commentId: string
  postId: string
  snapshot: QuoteSnapshot
}): React.ReactNode {
  const setQuote = useQuoteStore((s) => s.setQuote)

  const onClick = () => {
    setQuote({ commentId, postId, snapshot })
    const composer = document.querySelector<HTMLElement>('[data-role="comment-composer"]')
    composer?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-place-text-soft hover:text-place-text focus:outline-none focus-visible:underline"
    >
      Citar
    </button>
  )
}
