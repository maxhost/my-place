'use client'

import * as React from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { BaseComposer, type EnabledEmbeds } from './base-composer'
import { assertRichTextSize } from '../domain/size'
import { RichTextTooDeepError, RichTextTooLargeError } from '../domain/errors'
import type { LexicalDocument } from '../domain/types'
import type { ComposerMentionResolvers } from './mentions/mention-plugin'

export type LibraryItemComposerProps = {
  placeId: string
  /** Server action que persiste el body. La page maneja título + categoría
   *  + cover en inputs separados (form orchestrator). */
  onSubmit: (body: LexicalDocument) => Promise<void>
  composerResolvers: ComposerMentionResolvers
  enabledEmbeds: EnabledEmbeds
  initialDocument?: LexicalDocument
  placeholder?: string
  submitLabel?: string
  /** Si la page renderea inputs adicionales (título, cover, categoría),
   *  el composer NO los expone — sólo el body. La page los compone. */
  showSubmit?: boolean
  /** Cuando `showSubmit === false`, se emite cambios sin submit propio. */
  onChange?: (body: LexicalDocument | null) => void
}

/**
 * Composer de body de Library Item. Surface `library-item`: nodos
 * heading + listas + link + mention + embeds (mismo subset que `post`).
 * Soporta dos modos:
 *  - `showSubmit: true` (default): orquesta su propio botón "Guardar".
 *  - `showSubmit: false`: emite cambios al parent via `onChange` y el
 *    parent maneja el submit (típico cuando el form completo incluye
 *    título + cover + visibility en otros inputs).
 */
export function LibraryItemComposer({
  placeId,
  onSubmit,
  composerResolvers,
  enabledEmbeds,
  initialDocument,
  placeholder,
  submitLabel,
  showSubmit = true,
  onChange,
}: LibraryItemComposerProps): React.JSX.Element {
  const [doc, setDoc] = useState<LexicalDocument | null>(initialDocument ?? null)
  const [pending, setPending] = useState(false)
  const [composerKey, setComposerKey] = useState(0)

  const isEmpty = doc === null || doc.root.children.length === 0

  async function handleSubmit() {
    if (!doc || isEmpty) return
    try {
      assertRichTextSize(doc)
    } catch (err) {
      if (err instanceof RichTextTooLargeError) {
        toast.error('El recurso es demasiado largo.')
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
      setComposerKey((k) => k + 1)
      toast.success('Recurso guardado.')
    } catch (err) {
      const msg =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'No pudimos guardar el recurso.'
      toast.error(msg)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-4" data-testid="library-item-composer">
      <BaseComposer
        key={composerKey}
        surface="library-item"
        {...(initialDocument ? { initialDocument } : {})}
        onChange={(next) => {
          setDoc(next)
          onChange?.(next)
        }}
        placeholder={placeholder ?? 'Compartí lo que sabés con detalle…'}
        resolvers={{ ...composerResolvers, placeId }}
        enabledEmbeds={enabledEmbeds}
        ariaLabel="Editor del recurso"
      />

      {showSubmit ? (
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending || isEmpty}
            className="inline-flex min-h-12 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-bg disabled:opacity-60"
          >
            {pending ? 'Guardando…' : (submitLabel ?? 'Guardar')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
