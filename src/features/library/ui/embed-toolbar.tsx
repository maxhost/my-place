'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
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

type FormValues = {
  url: string
  title: string
}

/**
 * Botón "Insertar contenido" + Dialog con form (URL + título
 * opcional). Se usa dentro del `<LibraryItemForm>` (R.7.8) en el
 * compositor de items.
 *
 * Submit:
 *   1. Valida URL via `parseEmbedUrl` (rechaza javascript:/data:).
 *   2. Inserta el embed en la posición actual del editor con
 *      `editor.commands.insertContent({...})`.
 *   3. Cierra el modal.
 *
 * Toast de error si la URL es inválida.
 */
export function EmbedToolbar({ editor }: Props): React.ReactNode {
  const [open, setOpen] = useState(false)
  const { register, handleSubmit, reset } = useForm<FormValues>({
    defaultValues: { url: '', title: '' },
  })

  function onSubmit(values: FormValues): void {
    if (!editor) return
    try {
      const parsed = parseEmbedUrl(values.url)
      const title = values.title.trim()
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'embed',
          attrs: {
            url: values.url.trim(),
            provider: parsed.provider,
            title,
          },
        })
        .run()
      setOpen(false)
      reset()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'No pudimos procesar el link. Probá con otra URL.'
      toast.error(message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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

        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3" noValidate>
          <label className="block">
            <span className="mb-1 block text-sm text-muted">URL</span>
            <input
              type="url"
              required
              placeholder="https://youtube.com/watch?v=… o https://docs.google.com/…"
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-text focus:outline-none"
              {...register('url', { required: true })}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-muted">Título (opcional)</span>
            <input
              type="text"
              placeholder="Lección 1, Receta de galletas, Manual…"
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-text focus:border-text focus:outline-none"
              {...register('title')}
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
            <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm text-bg">
              Insertar
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
