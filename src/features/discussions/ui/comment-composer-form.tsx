'use client'

import { useCallback } from 'react'
import {
  CommentComposer,
  type LexicalDocument,
  type MentionUserResult,
} from '@/features/rich-text/public'
import { createCommentAction } from '../server/actions/comments'

/**
 * Wrapper client del `<CommentComposer>` adaptado al server action de
 * `createCommentAction` del slice `discussions`. El composer mantiene su
 * propio editor + estado; este wrapper solo:
 *  1. Inyecta `placeId` y la search-function de mentions.
 *  2. Adapta el `(body) => Promise<void>` del composer al shape
 *     `{ postId, body, quotedCommentId? }` que pide el action.
 *
 * F.4 sumará triggers `/event` y `/library` — la prop `searchUsers` se
 * extiende ahí a `searchMentions(query, kind)` con un dispatch interno.
 */
export function CommentComposerForm({
  placeId,
  postId,
}: {
  placeId: string
  postId: string
}): React.JSX.Element {
  // F.3: stub vacío. F.4 conectará `searchMembersByPlace(placeId, q)` (slice
  // `members`) a través de un Server Action que se invoca desde el cliente.
  // Sin búsqueda de usuarios el typeahead no abre — el `@` queda
  // textual hasta F.4. La estructura del shape `MentionResolversForEditor`
  // ya está lista para acelerar.
  const searchUsers = useCallback(async (_q: string): Promise<MentionUserResult[]> => {
    return []
  }, [])

  const onSubmit = useCallback(
    async (body: LexicalDocument) => {
      const res = await createCommentAction({ postId, body })
      if (!res.ok) throw new Error('No pudimos publicar el comentario.')
    },
    [postId],
  )

  return <CommentComposer placeId={placeId} onSubmit={onSubmit} searchUsers={searchUsers} />
}
