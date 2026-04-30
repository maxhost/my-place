'use client'

import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/shared/ui/dialog'
import { toast } from '@/shared/ui/toaster'
import { parseEmbedUrl } from '@/features/library/domain/embed-parser'

type Props = {
  editor: Editor | null
}

/**
 * Botón "Insertar contenido" + Dialog con form (URL + título
 * opcional). Se usa dentro del `<LibraryItemForm>` (R.7.8) en el
 * compositor de items.
 *
 * **No usamos `<form>` interno**: aunque Radix Dialog mounts su
 * contenido en un Portal (document.body), los eventos de React
 * bubblean por el árbol de componentes — un submit del form interno
 * propagaría al `<LibraryItemForm>` padre y dispararía
 * `createLibraryItemAction` en lugar de solo insertar el embed.
 * Por eso este modal usa state local + `onClick` directo.
 *
 * Flujo de inserción:
 *   1. Valida URL via `parseEmbedUrl` (rechaza javascript:/data:).
 *   2. Inserta el embed en la posición actual del editor con
 *      `editor.commands.insertContent({...})`.
 *   3. Cierra el modal y resetea inputs.
 *
 * Enter en el input URL invoca el mismo handler manualmente.
 *
 * Toast de error si la URL es inválida.
 */
export function EmbedToolbar({ editor }: Props): React.ReactNode {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')

  function reset(): void {
    setUrl('')
    setTitle('')
  }

  function handleInsert(): void {
    if (!editor) return
    const trimmedUrl = url.trim()
    if (trimmedUrl.length === 0) {
      toast.error('Pegá una URL válida.')
      return
    }
    try {
      const parsed = parseEmbedUrl(trimmedUrl)
      const trimmedTitle = title.trim()
      const attrs = {
        // Persistimos la URL canonical (post-parse) en el AST: para
        // YouTube/Vimeo/Gdoc/Gsheet ya viene en formato embed.
        // Drive/Dropbox/generic la dejan tal cual. Beneficio: el
        // renderer SSR no necesita re-parsear por cada render.
        url: parsed.canonicalUrl,
        provider: parsed.provider,
        title: trimmedTitle,
      }
      console.log('[EmbedToolbar] insertContent', { type: 'embed', attrs })
      editor.chain().focus().insertContent({ type: 'embed', attrs }).run()
      // Inspeccionamos el AST resultante post-insert para confirmar
      // que el nodo quedó con `attrs` plano (no function).
      const json = editor.getJSON()
      console.log('[EmbedToolbar] AST post-insert', json)
      setOpen(false)
      reset()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'No pudimos procesar el link. Probá con otra URL.'
      toast.error(message)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!editor}
        className="rounded-md border border-border bg-bg px-3 py-1.5 text-xs text-muted hover:text-text disabled:opacity-60"
      >
        Insertar contenido
      </button>
      <DialogContent>
        <DialogTitle>Insertar contenido</DialogTitle>
        <DialogDescription>
          Pegá un link de YouTube, Vimeo, Google Doc/Sheet, Drive, Dropbox o cualquier otro recurso
          público. Aparece intercalado en el lugar donde estás escribiendo.
        </DialogDescription>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm text-muted">URL</span>
            <input
              type="url"
              autoFocus
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  // Prevenimos que el Enter del input dispare el submit
                  // del `<LibraryItemForm>` padre (no estamos en form
                  // interno, pero el browser busca el form ancestor del
                  // input para Enter — en React tree puede subir).
                  e.preventDefault()
                  e.stopPropagation()
                  handleInsert()
                }
              }}
              placeholder="https://youtube.com/watch?v=… o https://docs.google.com/…"
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-text focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-muted">Título (opcional)</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation()
                  handleInsert()
                }
              }}
              placeholder="Lección 1, Receta de galletas, Manual…"
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-text focus:outline-none"
            />
            <span className="mt-1 block text-xs text-muted">
              Aparece encima del embed y se indexa para búsquedas futuras.
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <button
                type="button"
                className="rounded-md px-3 py-2 text-sm text-muted hover:text-text"
              >
                Cancelar
              </button>
            </DialogClose>
            <button
              type="button"
              onClick={handleInsert}
              className="rounded-md bg-accent px-4 py-2 text-sm text-bg"
            >
              Insertar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
