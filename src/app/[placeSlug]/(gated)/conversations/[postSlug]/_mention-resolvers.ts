import 'server-only'
import { findMemberProfile } from '@/features/members/public.server'
import type { MentionResolvers } from '@/features/rich-text/public.server'

/**
 * Construye los resolvers que el `RichTextRenderer` SSR usa para resolver
 * mentions a su href canónico. Compartido entre `<PostDetail>` (body del
 * post) y `<CommentsSection>` (bodies de comments).
 *
 * `event` / `libraryItem` quedan como stubs `null` hasta que se cableen
 * los lookups respectivos — el renderer pinta los placeholders `[EVENTO
 * NO DISPONIBLE]` / `[RECURSO NO DISPONIBLE]` mientras tanto.
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
    event: async () => null,
    libraryItem: async () => null,
  }
}
