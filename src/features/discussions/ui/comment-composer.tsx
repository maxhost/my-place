'use client'

import { useEffect, useState, useTransition } from 'react'
import { createCommentInputSchema } from '../schemas'
import { createCommentAction } from '../server/actions/comments'
import type { RichTextDocument } from '../domain/types'
import { RichTextEditor } from './rich-text-editor'
import { QuotePreview } from './quote-preview'
import { useQuoteStore } from './quote-store'
import { friendlyErrorMessage } from './utils'

/**
 * Composer de comment al pie del thread. Lee el store de citas (`useQuoteStore`)
 * para adjuntar un `quotedCommentId` al submit. Al cambiar de post (unmount),
 * limpia cualquier cita residual para evitar arrastre cross-thread.
 */
export function CommentComposer({ postId }: { postId: string }): React.ReactNode {
  const [pending, startTransition] = useTransition()
  const [body, setBody] = useState<RichTextDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formKey, setFormKey] = useState(0)

  const quote = useQuoteStore((s) => s.quote)
  const clearQuote = useQuoteStore((s) => s.clearQuote)

  // Reset cross-post: si el quote pertenece a otro post, descartarlo.
  useEffect(() => {
    if (quote && quote.postId !== postId) clearQuote()
  }, [postId, quote, clearQuote])

  // Cleanup al desmontar (navegación a otro thread).
  useEffect(() => {
    return () => clearQuote()
  }, [clearQuote])

  function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault()
    setError(null)

    const parsed = createCommentInputSchema.safeParse({
      postId,
      body,
      quotedCommentId: quote?.commentId,
    })
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      setError(first?.message ?? 'Revisá el contenido del comentario.')
      return
    }

    startTransition(async () => {
      try {
        await createCommentAction(parsed.data)
        setBody(null)
        setFormKey((k) => k + 1)
        clearQuote()
      } catch (err) {
        setError(friendlyErrorMessage(err))
      }
    })
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-3">
      {quote ? (
        <QuotePreview
          snapshot={quote.snapshot}
          currentState="VISIBLE"
          onRemove={
            <button
              type="button"
              onClick={clearQuote}
              aria-label="Quitar cita"
              className="rounded px-1 text-muted hover:text-text"
            >
              ×
            </button>
          }
        />
      ) : null}

      {error ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {error}
        </div>
      ) : null}

      <RichTextEditor
        key={formKey}
        content={body}
        onChange={setBody}
        ariaLabel="Escribir comentario"
        minHeightClassName="min-h-[6rem]"
      />

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-bg disabled:opacity-60"
        >
          {pending ? 'Enviando…' : quote ? 'Responder' : 'Comentar'}
        </button>
      </div>
    </form>
  )
}
