'use client'

import { useMemo } from 'react'
import {
  EventComposer,
  type ComposerMentionResolvers,
  type LexicalDocument,
} from '@/features/rich-text/public'
import { searchMembersByPlaceAction } from '@/features/members/public'
import { searchEventsByPlaceAction } from '@/features/events/public'
import {
  listLibraryCategoriesForMentionAction,
  searchLibraryItemsForMentionAction,
} from '@/features/library/public'

/**
 * Wrapper client del `<EventComposer>`. Sub-componente de `<EventForm>`
 * (slice events): emite cambios al parent que orquesta título + fechas
 * + RSVP. NO consume server actions de submit — eso lo hace `<EventForm>`
 * cuando el usuario confirma.
 */
export function EventComposerWrapper({
  placeId,
  initialDocument,
  onChange,
  placeholder,
}: {
  placeId: string
  initialDocument?: LexicalDocument
  onChange: (doc: LexicalDocument | null) => void
  placeholder?: string
}): React.JSX.Element {
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

  return (
    <EventComposer
      placeId={placeId}
      onChange={onChange}
      composerResolvers={composerResolvers}
      {...(initialDocument ? { initialDocument } : {})}
      {...(placeholder ? { placeholder } : {})}
    />
  )
}
