'use client'

import * as React from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { BaseComposer, type EnabledEmbeds } from './base-composer'
import { assertRichTextSize } from '../domain/size'
import { RichTextTooDeepError, RichTextTooLargeError } from '../domain/errors'
import type { LexicalDocument } from '../domain/types'
import type { ComposerMentionResolvers } from './mentions/mention-plugin'

const TITLE_MIN = 5
const TITLE_MAX = 120

export type PostComposerProps = {
  placeId: string
  /** Server action que persiste el post completo. */
  onSubmit: (data: { title: string; body: LexicalDocument }) => Promise<void>
  /** Resolvers para mentions (`@user`, `/event`, `/library/<cat>`). */
  composerResolvers: ComposerMentionResolvers
  /** Embeds activados por place (F.5: lectura del flag column). */
  enabledEmbeds: EnabledEmbeds
  initialDocument?: LexicalDocument
  initialTitle?: string
  /** Variante UX: "Publicar" para create, "Guardar cambios" para edit. */
  submitLabel?: string
}

/**
 * Composer canónico de posts (Conversaciones). Surface `post`: nodos
 * heading + listas + link + mention + embeds. Form orchestrator: title
 * + body + submit con validación de tamaño + reset post-éxito.
 *
 * Patrón heredado de `CommentComposer` extendido con `<input>` para
 * título y botones de toolbar (F.4: mínimo viable; iteraciones futuras
 * pueden expandir la toolbar a botones de bold/heading/etc.).
 */
export function PostComposer({
  placeId,
  onSubmit,
  composerResolvers,
  enabledEmbeds,
  initialDocument,
  initialTitle,
  submitLabel,
}: PostComposerProps): React.JSX.Element {
  const [title, setTitle] = useState(initialTitle ?? '')
  const [doc, setDoc] = useState<LexicalDocument | null>(initialDocument ?? null)
  const [pending, setPending] = useState(false)
  const [composerKey, setComposerKey] = useState(0)

  const trimmedTitle = title.trim()
  const titleValid = trimmedTitle.length >= TITLE_MIN && trimmedTitle.length <= TITLE_MAX
  const isEmpty = doc === null || doc.root.children.length === 0
  const submitDisabled = pending || !titleValid || isEmpty

  async function handleSubmit() {
    if (submitDisabled || !doc) return
    try {
      assertRichTextSize(doc)
    } catch (err) {
      if (err instanceof RichTextTooLargeError) {
        toast.error('La conversación es demasiado larga.')
        return
      }
      if (err instanceof RichTextTooDeepError) {
        toast.error('Demasiados niveles de lista anidada.')
        return
      }
      toast.error('No pudimos validar el contenido.')
      return
    }
    setPending(true)
    try {
      await onSubmit({ title: trimmedTitle, body: doc })
      setTitle('')
      setDoc(null)
      setComposerKey((k) => k + 1)
      toast.success('Conversación publicada.')
    } catch (err) {
      const msg =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'No pudimos publicar la conversación.'
      toast.error(msg)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-4" data-testid="post-composer">
      <label className="block">
        <span className="mb-1 block text-sm text-muted">Título</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={TITLE_MAX}
          placeholder="Un título claro ayuda a quienes pasen luego."
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text focus:border-bg focus:outline-none"
        />
        <span className="mt-1 block text-xs text-muted">
          Entre {TITLE_MIN} y {TITLE_MAX} caracteres.
        </span>
      </label>

      <BaseComposer
        key={composerKey}
        surface="post"
        {...(initialDocument ? { initialDocument } : {})}
        onChange={setDoc}
        placeholder="Escribí lo que quieras compartir…"
        resolvers={{ ...composerResolvers, placeId }}
        enabledEmbeds={enabledEmbeds}
        ariaLabel="Editor de conversación"
      />

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitDisabled}
          className="inline-flex min-h-12 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-bg disabled:opacity-60"
        >
          {pending ? 'Publicando…' : (submitLabel ?? 'Publicar')}
        </button>
      </div>
    </div>
  )
}
