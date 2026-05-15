'use client'

import { useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PostComposer, type EnabledEmbeds } from '@/features/rich-text/composers/public'
import type { ComposerMentionResolvers, LexicalDocument } from '@/features/rich-text/public'
import { searchMembersByPlaceAction } from '@/features/members/public'
import { searchEventsByPlaceAction } from '@/features/events/public'
import {
  listLibraryCategoriesForMentionAction,
  searchLibraryItemsForMentionAction,
} from '@/features/library/public'
import { createPostAction, editPostAction } from '../server/actions/posts'
import { friendlyErrorMessage } from './utils'

type CreateMode = { kind: 'create' }

type EditMode = {
  kind: 'edit'
  postId: string
  /** Slug actual del post — destino del redirect post-guardar. El slug
   *  NO cambia al editar (inmutable post-create, igual que library). */
  postSlug: string
  expectedVersion: number
  initialTitle: string
  /** `null` si el post no tiene body (raro pero válido en el schema). */
  initialDocument: LexicalDocument | null
  /** Token de edit-session (autor no-admin, grace 5min). `null` cuando
   *  el viewer es admin/owner/grupo delegado (no requiere token). */
  session: { token: string; openedAt: string } | null
}

export type PostComposerWrapperProps = {
  mode: CreateMode | EditMode
  placeId: string
  enabledEmbeds: EnabledEmbeds
}

/**
 * Wrapper client del `<PostComposer>`. Soporta crear y editar
 * conversaciones (discriminated union `mode`, mismo patrón que
 * `<LibraryItemComposerForm>`). Inyecta los 4 resolvers de mention
 * desde los Server Actions de cada slice dueño.
 *
 * Edit: dispara `editPostAction` con `expectedVersion` (optimistic
 * lock) + `session` cuando aplica. Errores del dominio (ConflictError,
 * EditWindowExpired, EditSessionInvalid) se mapean con
 * `friendlyErrorMessage` — no se reinventa el copy.
 */
export function PostComposerWrapper({
  mode,
  placeId,
  enabledEmbeds,
}: PostComposerWrapperProps): React.JSX.Element {
  const router = useRouter()

  const composerResolvers: ComposerMentionResolvers = useMemo(
    () => ({
      placeId,
      searchUsers: async (q) => searchMembersByPlaceAction(placeId, q),
      searchEvents: async (q) => searchEventsByPlaceAction(placeId, q),
      listCategories: async () => listLibraryCategoriesForMentionAction(placeId),
      searchLibraryItems: async (categorySlug, q) =>
        searchLibraryItemsForMentionAction(placeId, categorySlug, q),
    }),
    [placeId],
  )

  const onSubmit = useCallback(
    async ({ title, body }: { title: string; body: LexicalDocument }) => {
      if (mode.kind === 'create') {
        const res = await createPostAction({ placeId, title, body })
        if (!res.ok) throw new Error('No pudimos publicar la conversación.')
        // `router.replace` (no `push`): el form queda obsoleto post-publish.
        // Ver `docs/decisions/2026-05-09-back-navigation-origin.md`.
        router.replace(`/conversations/${res.slug}?from=conversations`)
        return
      }

      try {
        await editPostAction({
          postId: mode.postId,
          title,
          body,
          expectedVersion: mode.expectedVersion,
          ...(mode.session ? { session: mode.session } : {}),
        })
      } catch (err) {
        toast.error(friendlyErrorMessage(err))
        return
      }
      toast.success('Conversación actualizada.')
      router.replace(`/conversations/${mode.postSlug}?from=conversations`)
    },
    [mode, placeId, router],
  )

  return (
    <PostComposer
      placeId={placeId}
      onSubmit={onSubmit}
      composerResolvers={composerResolvers}
      enabledEmbeds={enabledEmbeds}
      {...(mode.kind === 'edit'
        ? {
            initialTitle: mode.initialTitle,
            submitLabel: 'Guardar cambios',
            ...(mode.initialDocument ? { initialDocument: mode.initialDocument } : {}),
          }
        : {})}
    />
  )
}
