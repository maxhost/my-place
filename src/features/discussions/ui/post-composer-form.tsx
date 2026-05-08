'use client'

import { useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { PostComposer, type EnabledEmbeds } from '@/features/rich-text/composers/public'
import type { ComposerMentionResolvers, LexicalDocument } from '@/features/rich-text/public'
import { searchMembersByPlaceAction } from '@/features/members/public'
import { searchEventsByPlaceAction } from '@/features/events/public'
import {
  listLibraryCategoriesForMentionAction,
  searchLibraryItemsForMentionAction,
} from '@/features/library/public'
import { createPostAction } from '../server/actions/posts'

/**
 * Wrapper client del `<PostComposer>` para crear conversaciones nuevas.
 * Construye los 4 resolvers de mention desde Server Actions de cada
 * slice dueño (members/events/library) — `discussions` es el slice
 * orchestrator que ya consume el resto.
 */
export function PostComposerWrapper({
  placeId,
  enabledEmbeds,
}: {
  placeId: string
  enabledEmbeds: EnabledEmbeds
}): React.JSX.Element {
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
      const res = await createPostAction({ placeId, title, body })
      if (!res.ok) throw new Error('No pudimos publicar la conversación.')
      // Public path: el subdominio del place ya está implícito en el host
      // — el path NO incluye `/${placeSlug}`. (Ver memoria userEmail § URLs.)
      router.push(`/conversations/${res.slug}`)
    },
    [placeId, router],
  )

  return (
    <PostComposer
      placeId={placeId}
      onSubmit={onSubmit}
      composerResolvers={composerResolvers}
      enabledEmbeds={enabledEmbeds}
    />
  )
}
