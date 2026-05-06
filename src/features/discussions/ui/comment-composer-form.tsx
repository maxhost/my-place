'use client'

import { useCallback } from 'react'
import {
  CommentComposer,
  type LexicalDocument,
  type MentionUserResult,
} from '@/features/rich-text/public'
import { searchMembersByPlaceAction } from '@/features/members/public'
import { createCommentAction } from '../server/actions/comments'

/**
 * Wrapper client del `<CommentComposer>` adaptado al server action de
 * `createCommentAction`. F.4: typeahead `@` real via
 * `searchMembersByPlaceAction` (Server Action wrapper de la query
 * cacheada del slice `members`).
 */
export function CommentComposerForm({
  placeId,
  postId,
}: {
  placeId: string
  postId: string
}): React.JSX.Element {
  const searchUsers = useCallback(
    async (q: string): Promise<MentionUserResult[]> => {
      const rows = await searchMembersByPlaceAction(placeId, q)
      return rows.map((r) => ({
        userId: r.userId,
        displayName: r.displayName,
        handle: r.handle,
      }))
    },
    [placeId],
  )

  const onSubmit = useCallback(
    async (body: LexicalDocument) => {
      const res = await createCommentAction({ postId, body })
      if (!res.ok) throw new Error('No pudimos publicar el comentario.')
    },
    [postId],
  )

  return <CommentComposer placeId={placeId} onSubmit={onSubmit} searchUsers={searchUsers} />
}
