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

export type CategoryOption = {
  id: string
  slug: string
  emoji: string
  title: string
}

type CreateMode = {
  kind: 'create'
  placeId: string
  /**
   * Si está fijo (entrando via /library/[cat]/new), no se renderiza
   * selector. Si es null (entrando via /library/new), se muestra
   * selector con `availableCategories`.
   */
  fixedCategory: { id: string; slug: string } | null
  /** Categorías donde el viewer tiene permiso de crear. Solo se usa
   *  cuando `fixedCategory === null`. Si está vacío en ese modo, el
   *  form muestra mensaje "no hay categorías disponibles". */
  availableCategories: ReadonlyArray<CategoryOption>
  /** Slug de la categoría para fallback de "Cancelar" cuando hay
   *  fixedCategory; sin él, cancelar va a `/library`. */
  cancelCategorySlug?: string
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
  categoryId: string
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
      ? {
          title: '',
          coverUrl: '',
          categoryId: mode.fixedCategory?.id ?? mode.availableCategories[0]?.id ?? '',
        }
      : {
          title: mode.initialTitle,
          coverUrl: mode.initialCoverUrl ?? '',
          categoryId: '',
        }

  const { register, handleSubmit, formState } = useForm<FormValues>({
    defaultValues: initial,
  })

  function onSubmit(values: FormValues): void {
    console.log('[LibraryItemForm] onSubmit START', { mode: mode.kind })
    setFeedback(null)
    const trimmedTitle = values.title.trim()
    const coverUrl = values.coverUrl.trim() === '' ? null : values.coverUrl.trim()

    // Pre-serializar el body a JSON puro: TipTap puede retornar un AST
    // donde algunos attrs son getters/proxies (las attrs del embed
    // custom node se persistían como function en bodyRaw del server
    // log antes de este fix — confirmado empíricamente). El roundtrip
    // JSON.parse(JSON.stringify(...)) strippea cualquier function /
    // getter / proxy y deja un objeto plano serializable.
    let bodyJson: RichTextDoc
    try {
      bodyJson = JSON.parse(JSON.stringify(body)) as RichTextDoc
    } catch (err) {
      console.error('[LibraryItemForm] body JSON serialize failed', err)
      setFeedback({ kind: 'err', message: 'No pudimos serializar el contenido. Reintentá.' })
      return
    }

    console.log('[LibraryItemForm] submit payload', {
      title: trimmedTitle,
      coverUrl,
      body: bodyJson,
    })

    startTransition(async () => {
      try {
        if (mode.kind === 'create') {
          const targetCategoryId = mode.fixedCategory?.id ?? values.categoryId
          if (!targetCategoryId) {
            setFeedback({ kind: 'err', message: 'Elegí una categoría para el recurso.' })
            return
          }
          const result = await createLibraryItemAction({
            placeId: mode.placeId,
            categoryId: targetCategoryId,
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

      {mode.kind === 'create' && mode.fixedCategory === null ? (
        mode.availableCategories.length === 0 ? (
          <div
            role="status"
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          >
            No hay categorías donde puedas crear recursos. Pedile a un admin que te dé acceso o que
            cree una categoría con permisos abiertos.
          </div>
        ) : (
          <label className="block">
            <span className="mb-1 block text-sm text-muted">Categoría</span>
            <select
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text focus:border-bg focus:outline-none"
              {...register('categoryId', { required: true })}
            >
              {mode.availableCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.title}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-muted">
              El recurso queda agrupado dentro de la categoría que elijas.
            </span>
          </label>
        )
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
            const fallback = computeCancelHref(mode)
            if (typeof window !== 'undefined' && window.history.length > 1) {
              router.back()
            } else {
              router.push(fallback)
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
 * Resuelve a dónde mandar al user al cancelar:
 *  - edit → la categoría del item.
 *  - create con fixedCategory → esa categoría (vienes de
 *    /library/[cat]/new).
 *  - create con cancelCategorySlug explícito → ese slug.
 *  - create sin categoría (vienes de /library/new) → /library.
 */
function computeCancelHref(mode: CreateMode | EditMode): string {
  if (mode.kind === 'edit') return `/library/${mode.categorySlug}`
  if (mode.cancelCategorySlug) return `/library/${mode.cancelCategorySlug}`
  if (mode.fixedCategory) return `/library/${mode.fixedCategory.slug}`
  return '/library'
}
