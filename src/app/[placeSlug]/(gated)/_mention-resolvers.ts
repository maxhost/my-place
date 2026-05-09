import 'server-only'
import { findMemberProfile } from '@/features/members/public.server'
import { findEventForMention } from '@/features/events/public.server'
import { findLibraryItemForMention } from '@/features/library/public.server'
import type { MentionResolvers } from '@/features/rich-text/public.server'

/**
 * Construye los resolvers que el `RichTextRenderer` SSR usa para resolver
 * mentions a su href canónico. Compartido entre `<PostDetail>` (body del
 * post) y `<CommentsSection>` (bodies de comments).
 *
 * Lookup defensivo por slice: si el target fue archivado/cancelado/
 * eliminado el resolver retorna `null` y el renderer pinta el placeholder
 * `[EVENTO NO DISPONIBLE]` / `[RECURSO NO DISPONIBLE]`.
 */
export function buildMentionResolvers({ placeId }: { placeId: string }): MentionResolvers {
  return {
    user: async (userId) => {
      const profile = await findMemberProfile(placeId, userId)
      if (!profile) return null
      return {
        label: profile.user.displayName,
        href: `/m/${userId}`,
      }
    },
    event: async (eventId) => {
      const event = await findEventForMention(eventId, placeId)
      if (!event) return null
      // F.F: el evento ES el thread — vive bajo `/conversations/<postSlug>`.
      // Las mentions se renderizan dentro de bodies de Posts/Comments que
      // viven en `/conversations/...`, así que el origen siempre es
      // `conversations` (el back desde el target debería volver acá).
      return {
        label: event.title,
        href: `/conversations/${event.postSlug}?from=conversations`,
      }
    },
    libraryItem: async (itemId) => {
      const item = await findLibraryItemForMention(itemId, placeId)
      if (!item) return null
      // Mismo razonamiento que `event`: la mention vive en un body
      // renderizado bajo `/conversations/...`, así que `?from=conversations`
      // hace que el back del item detail vuelva a la conversación origen.
      return {
        label: item.title,
        href: `/library/${item.categorySlug}/${item.postSlug}?from=conversations`,
      }
    },
  }
}
