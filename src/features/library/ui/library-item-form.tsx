'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { useRouter } from 'next/navigation'
import {
  ITEM_COVER_URL_MAX_LENGTH,
  ITEM_TITLE_MAX_LENGTH,
  ITEM_TITLE_MIN_LENGTH,
  createLibraryItemAction,
  updateLibraryItemAction,
} from '@/features/library/public'
import { friendlyLibraryErrorMessage } from './admin/errors'
import { LibraryItemEditor } from './library-item-editor'

type RichTextDoc = { type: 'doc'; content?: unknown[] }

type CreateMode = {
  kind: 'create'
  placeId: string
  categoryId: string
  /** Slug de la categoría para construir el redirect canónico. */
  categorySlug: string
}

type EditMode = {
  kind: 'edit'
  itemId: string
  categorySlug: string
  initialTitle: string
  initialBody: RichTextDoc | null
  initialCoverUrl: string | null
}

type Props = {
  mode: CreateMode | EditMode
}

type FormValues = {
  title: string
  coverUrl: string
}

type Feedback = { kind: 'err'; message: string } | null

const EMPTY_DOC: RichTextDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

/**
 * Form de crear/editar item de biblioteca (R.7.8).
 *
 * Combina título + cover URL opcional + editor TipTap con embeds
 * intercalados. La misma UI sirve los 2 modos: el `mode.kind` decide
 * la action a invocar y la URL de redirect.
 *
 * Submit success en create: redirect 303 a la URL canónica
 * `/library/[categorySlug]/[postSlug]` (decidida en spec § 13.1).
 *
 * Submit success en edit: redirect a la canónica también; cualquier
 * cambio del título NO regenera el slug (Post.slug inmutable).
 */
export function LibraryItemForm({ mode }: Props): React.ReactNode {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [body, setBody] = useState<RichTextDoc>(
    mode.kind === 'edit' && mode.initialBody ? mode.initialBody : EMPTY_DOC,
  )

  const initial: FormValues =
    mode.kind === 'create'
      ? { title: '', coverUrl: '' }
      : {
          title: mode.initialTitle,
          coverUrl: mode.initialCoverUrl ?? '',
        }

  const { register, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: initial,
  })

  function onSubmit(values: FormValues): void {
    console.log('[LibraryItemForm] onSubmit START')
    setFeedback(null)
    const trimmedTitle = values.title.trim()
    const coverUrl = values.coverUrl.trim() === '' ? null : values.coverUrl.trim()

    // Defensa: serializar el body a JSON puro antes de mandarlo al
    // server action. TipTap puede retornar un AST con getters/proxies
    // (las attrs del custom node embed se persistían como function en
    // bodyRaw del server log). JSON.parse(JSON.stringify(...)) strippea
    // cualquier function/getter/proxy y deja un objeto plano serializable.
    let bodyJson: RichTextDoc
    try {
      bodyJson = JSON.parse(JSON.stringify(body)) as RichTextDoc
    } catch (err) {
      console.error('[LibraryItemForm] body JSON serialize failed', err)
      setFeedback({ kind: 'err', message: 'No pudimos serializar el contenido. Reintentá.' })
      return
    }

    console.log('[LibraryItemForm] submit', {
      mode: mode.kind,
      title: trimmedTitle,
      coverUrl,
      bodyTypes: collectNodeTypes(bodyJson),
      body: bodyJson,
    })

    startTransition(async () => {
      try {
        if (mode.kind === 'create') {
          const result = await createLibraryItemAction({
            placeId: mode.placeId,
            categoryId: mode.categoryId,
            title: trimmedTitle,
            body: bodyJson,
            coverUrl,
          })
          console.log('[LibraryItemForm] create OK', result)
          router.replace(`/library/${result.categorySlug}/${result.postSlug}`)
        } else {
          const result = await updateLibraryItemAction({
            itemId: mode.itemId,
            title: trimmedTitle,
            body: bodyJson,
            coverUrl,
          })
          console.log('[LibraryItemForm] update OK', result)
          router.replace(`/library/${result.categorySlug}/${result.postSlug}`)
          router.refresh()
        }
      } catch (err) {
        console.error('[LibraryItemForm] submit failed', {
          name: err instanceof Error ? err.name : typeof err,
          message: err instanceof Error ? err.message : String(err),
          err,
        })
        setFeedback({ kind: 'err', message: friendlyLibraryErrorMessage(err) })
      }
    })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      {feedback?.kind === 'err' ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {feedback.message}
        </div>
      ) : null}

      <label className="block">
        <span className="mb-1 block text-sm text-muted">Título</span>
        <input
          type="text"
          maxLength={ITEM_TITLE_MAX_LENGTH}
          aria-invalid={formState.errors.title ? true : undefined}
          placeholder="Receta de galletas, Curso de cocina, Manual del taller…"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text focus:border-bg focus:outline-none"
          {...register('title', { required: true, minLength: ITEM_TITLE_MIN_LENGTH })}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm text-muted">Cover (opcional)</span>
        <input
          type="url"
          maxLength={ITEM_COVER_URL_MAX_LENGTH}
          placeholder="https://… (no se renderiza en mobile, reservado para vista desktop)"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text focus:border-bg focus:outline-none"
          {...register('coverUrl')}
        />
        <span className="mt-1 block text-xs text-muted">
          La imagen se guarda pero hoy no se muestra en mobile. Apareciera en la vista desktop
          futura.
        </span>
      </label>

      <div>
        <span className="mb-1 block text-sm text-muted">Contenido</span>
        <LibraryItemEditor content={body} onChange={setBody} />
        <span className="mt-1 block text-xs text-muted">
          Insertá videos, docs o links con el botón “Insertar contenido” de la barra. Aparecen
          intercalados donde estás escribiendo.
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-bg disabled:opacity-60"
        >
          {pending
            ? mode.kind === 'create'
              ? 'Publicando…'
              : 'Guardando…'
            : mode.kind === 'create'
              ? 'Publicar'
              : 'Guardar cambios'}
        </button>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined' && window.history.length > 1) {
              router.back()
            } else {
              router.push(`/library/${mode.categorySlug}`)
            }
          }}
          disabled={pending}
          className="rounded-md px-3 py-2 text-sm text-muted hover:text-text"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}

/**
 * Recorre el AST del body y devuelve el set de tipos de nodos
 * presentes — útil para diagnosticar rápidamente si hay un nodo
 * TipTap fuera del allowlist del schema Zod del server.
 */
function collectNodeTypes(node: unknown): string[] {
  const types = new Set<string>()
  function walk(n: unknown): void {
    if (!n || typeof n !== 'object') return
    const obj = n as { type?: unknown; content?: unknown; marks?: unknown }
    if (typeof obj.type === 'string') types.add(obj.type)
    if (Array.isArray(obj.content)) obj.content.forEach(walk)
    if (Array.isArray(obj.marks)) obj.marks.forEach(walk)
  }
  walk(node)
  return [...types].sort()
}
