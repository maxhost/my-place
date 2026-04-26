'use client'

import { useEffect, useState, useTransition } from 'react'
import { Send } from 'lucide-react'
import { createCommentInputSchema } from '../schemas'
import { createCommentAction } from '../server/actions/comments'
import type { RichTextDocument } from '../domain/types'
import { RichTextEditor } from './rich-text-editor'
import { QuotePreview } from './quote-preview'
import { useQuoteStore } from './quote-store'
import { friendlyErrorMessage } from './utils'

/**
 * Composer de comment al pie del thread (R.6.4 layout).
 *
 * Posicionamiento: `fixed bottom-0 inset-x-0 mx-auto max-w-[420px]` para
 * pinned al bottom de la viewport, alineado con la columna del shell
 * (`AppShell` usa `max-w-[420px]`). El page composer del thread detail
 * agrega `pb-[120px]` para que el último comment no quede tapado.
 *
 * Por qué `fixed` en vez de `sticky`: el shell main es `flex-1
 * overflow-x-hidden` (vertical libre, body scrollea) — sticky `bottom-0`
 * pinearía al fondo del último contenido, no de la viewport. `fixed`
 * resuelve sin requerir scroll container interno.
 *
 * `safe-area-inset-bottom` agrega padding inferior para devices con
 * notch / home bar (iOS Safari principalmente).
 *
 * Lee el store de citas (`useQuoteStore`) para adjuntar un
 * `quotedCommentId` al submit. Al cambiar de post (unmount), limpia
 * cualquier cita residual para evitar arrastre cross-thread.
 *
 * Ver `docs/features/discussions/spec.md` § 21.2.
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
    <div
      className="bg-bg/90 supports-[backdrop-filter]:bg-bg/80 fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[420px] border-t-[0.5px] border-border backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-2 px-3 py-3">
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
            className="rounded-md border-[0.5px] border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            {error}
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <RichTextEditor
              key={formKey}
              content={body}
              onChange={setBody}
              ariaLabel="Escribir comentario"
              minHeightClassName="min-h-[44px]"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            aria-label={quote ? 'Responder' : 'Comentar'}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-bg hover:opacity-90 disabled:opacity-60 motion-safe:transition-opacity"
          >
            <Send size={16} aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  )
}
