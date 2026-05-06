'use client'

import * as React from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { BaseComposer } from './base-composer'
import { assertRichTextSize } from '../domain/size'
import { RichTextTooDeepError, RichTextTooLargeError } from '../domain/errors'
import type { LexicalDocument } from '../domain/types'
import type { MentionUserResult } from './mentions/mention-plugin'

export type CommentComposerProps = {
  placeId: string
  /**
   * Server action / handler que persiste el comentario. Sincronizá la
   * revalidación de paths dentro del action — el composer sólo reporta
   * éxito/error visualmente.
   */
  onSubmit: (body: LexicalDocument) => Promise<void>
  /**
   * Búsqueda de usuarios para el typeahead `@`. La page consumer la
   * inyecta importando de `@/features/members/public.server` —
   * `rich-text/` no toca otros slices directamente.
   */
  searchUsers: (q: string) => Promise<MentionUserResult[]>
  initialDocument?: LexicalDocument
  placeholder?: string
}

/**
 * Composer canónico de respuestas en threads. Surface piloto de F.3.
 *
 * Form orchestrator alrededor de `BaseComposer`:
 *  - mantiene el documento Lexical en estado.
 *  - valida tamaño (`assertRichTextSize`) antes de mandar al action.
 *  - resetea al éxito (forzando re-mount via `composerKey`) — Lexical
 *    no expone un `setEditorState(empty)` simple sin tocar la API
 *    interna; remontar es correcto y predictible.
 *  - notifica vía `sonner` (mismo patrón que invitaciones / hours).
 */
export function CommentComposer({
  placeId,
  onSubmit,
  searchUsers,
  initialDocument,
  placeholder,
}: CommentComposerProps): React.JSX.Element {
  const [doc, setDoc] = useState<LexicalDocument | null>(initialDocument ?? null)
  const [pending, setPending] = useState(false)
  const [composerKey, setComposerKey] = useState(0)

  const isEmpty = doc === null || doc.root.children.length === 0 || isAllBlanks(doc)

  async function handleSubmit() {
    if (!doc || isEmpty) return
    try {
      assertRichTextSize(doc)
    } catch (err) {
      if (err instanceof RichTextTooLargeError) {
        toast.error('El mensaje es demasiado largo. Acortá un poco antes de publicar.')
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
      await onSubmit(doc)
      setDoc(null)
      setComposerKey((k) => k + 1)
      toast.success('Comentario publicado.')
    } catch (err) {
      const message =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'No pudimos publicar el comentario.'
      toast.error(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-3">
      <BaseComposer
        key={composerKey}
        surface="comment"
        {...(initialDocument ? { initialDocument } : {})}
        onChange={setDoc}
        placeholder={placeholder ?? 'Aportar al hilo…'}
        resolvers={{ placeId, searchUsers }}
        ariaLabel="Editor de respuesta"
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={pending || isEmpty}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Publicando…' : 'Publicar'}
      </button>
    </div>
  )
}

function isAllBlanks(doc: LexicalDocument): boolean {
  for (const block of doc.root.children) {
    if (block.type !== 'paragraph') return false
    for (const child of block.children) {
      if (child.type === 'mention') return false
      if (child.type === 'link') return false
      if (child.type === 'text' && child.text.trim().length > 0) return false
    }
  }
  return true
}
