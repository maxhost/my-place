'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { LibraryItemComposer, type EnabledEmbeds } from '@/features/rich-text/composers/public'
import type { ComposerMentionResolvers, LexicalDocument } from '@/features/rich-text/public'
import { searchMembersByPlaceAction } from '@/features/members/public'
import { searchEventsByPlaceAction } from '@/features/events/public'
import {
  listLibraryCategoriesForMentionAction,
  searchLibraryItemsForMentionAction,
} from '@/features/library/public'

const TITLE_MIN = 5
const TITLE_MAX = 120
const COVER_MAX = 2048

type CreateMode = {
  kind: 'create'
  placeId: string
  categoryId: string
  /** Slug actual de la categoría — usado al armar la URL de redirect. */
  categorySlug: string
  onCreate: (
    input: unknown,
  ) => Promise<{ ok: true; itemId: string; postSlug: string; categorySlug: string }>
}

type EditMode = {
  kind: 'edit'
  placeId: string
  itemId: string
  expectedVersion: number
  /** Slug actual de la categoría — la edición no la cambia. */
  categorySlug: string
  initialTitle: string
  initialDocument: LexicalDocument
  initialCoverUrl: string | null
  onUpdate: (input: unknown) => Promise<{ ok: true; postSlug: string }>
}

export type LibraryItemComposerFormProps = {
  mode: CreateMode | EditMode
  enabledEmbeds: EnabledEmbeds
}

/**
 * Wrapper full-form para Library Items. Combina inputs del item
 * (título + cover + body) en un solo formulario. Usa
 * `<LibraryItemComposer>` con `showSubmit=false` y orquesta submit
 * acá porque maneja varios inputs paralelos.
 */
export function LibraryItemComposerForm({
  mode,
  enabledEmbeds,
}: LibraryItemComposerFormProps): React.JSX.Element {
  const router = useRouter()

  const [title, setTitle] = useState(mode.kind === 'edit' ? mode.initialTitle : '')
  const [coverUrl, setCoverUrl] = useState(mode.kind === 'edit' ? (mode.initialCoverUrl ?? '') : '')
  const [doc, setDoc] = useState<LexicalDocument | null>(
    mode.kind === 'edit' ? mode.initialDocument : null,
  )
  const [pending, setPending] = useState(false)

  const trimmedTitle = title.trim()
  const titleValid = trimmedTitle.length >= TITLE_MIN && trimmedTitle.length <= TITLE_MAX
  const isEmpty = doc === null || doc.root.children.length === 0
  const submitDisabled = pending || !titleValid || isEmpty

  const composerResolvers: ComposerMentionResolvers = useMemo(
    () => ({
      placeId: mode.placeId,
      searchUsers: async (q) => searchMembersByPlaceAction(mode.placeId, q),
      searchEvents: async (q) => searchEventsByPlaceAction(mode.placeId, q),
      listCategories: async () => listLibraryCategoriesForMentionAction(mode.placeId),
      searchLibraryItems: async (categorySlug, q) =>
        searchLibraryItemsForMentionAction(mode.placeId, categorySlug, q),
    }),
    [mode.placeId],
  )

  const handleSubmit = useCallback(async () => {
    if (submitDisabled || !doc) return
    setPending(true)
    try {
      const cover = coverUrl.trim().length > 0 ? coverUrl.trim() : null
      if (mode.kind === 'create') {
        const res = await mode.onCreate({
          placeId: mode.placeId,
          categoryId: mode.categoryId,
          title: trimmedTitle,
          body: doc,
          coverUrl: cover,
        })
        toast.success('Recurso publicado.')
        router.push(`/library/${res.categorySlug}/${res.postSlug}`)
      } else {
        const res = await mode.onUpdate({
          itemId: mode.itemId,
          title: trimmedTitle,
          body: doc,
          coverUrl: cover,
          expectedVersion: mode.expectedVersion,
        })
        toast.success('Recurso actualizado.')
        router.push(`/library/${mode.categorySlug}/${res.postSlug}`)
      }
    } catch (err) {
      const msg =
        err instanceof Error && err.message.length > 0
          ? err.message
          : 'No pudimos guardar el recurso.'
      toast.error(msg)
    } finally {
      setPending(false)
    }
  }, [submitDisabled, doc, coverUrl, trimmedTitle, mode, router])

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm text-muted">Título</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={TITLE_MAX}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text focus:border-bg focus:outline-none"
        />
        <span className="mt-1 block text-xs text-muted">
          Entre {TITLE_MIN} y {TITLE_MAX} caracteres.
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm text-muted">URL de portada (opcional)</span>
        <input
          type="url"
          value={coverUrl}
          onChange={(e) => setCoverUrl(e.target.value)}
          maxLength={COVER_MAX}
          placeholder="https://…"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text focus:border-bg focus:outline-none"
        />
      </label>

      <LibraryItemComposer
        placeId={mode.placeId}
        onSubmit={async () => {
          /* parent maneja submit */
        }}
        composerResolvers={composerResolvers}
        enabledEmbeds={enabledEmbeds}
        {...(mode.kind === 'edit' && mode.initialDocument
          ? { initialDocument: mode.initialDocument }
          : {})}
        showSubmit={false}
        onChange={setDoc}
      />

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitDisabled}
          className="inline-flex min-h-12 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-bg disabled:opacity-60"
        >
          {pending
            ? mode.kind === 'create'
              ? 'Publicando…'
              : 'Guardando…'
            : mode.kind === 'create'
              ? 'Publicar recurso'
              : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}
