import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import {
  PostList,
  listPostsByPlace,
  parsePostListFilter,
  resolveViewerForPlace,
} from '@/features/discussions/public'

type Props = {
  params: Promise<{ placeSlug: string }>
  searchParams: Promise<{ filter?: string }>
}

/**
 * Lista de discusiones del place (R.6 + follow-up F.2).
 *
 * La primera página se arma SSR (`listPostsByPlace` extendido con
 * snippet/commentCount/readerSample/isFeatured + filter aplicado);
 * `<PostList>` compone el chrome (SectionHeader + Filter pills +
 * Featured + Rows) y delega el scroll extra al Client Component
 * `<LoadMorePosts>`.
 *
 * **Filter** (`?filter=all|unanswered|participating`): el query param
 * es la source of truth. `parsePostListFilter` es defensivo (Zod
 * `.catch('all')` para inputs inválidos). El filter se propaga al
 * query y al `<PostList>` para que `<LoadMorePosts>` lo mantenga
 * en cada page de paginación, y para que `<EmptyThreads>` rote su
 * copy según el filter activo.
 *
 * Crear o editar un post vive en su propio route `/conversations/new`
 * (con `?edit=<postId>`). El CTA "Nueva" vive ahora dentro del FAB
 * cross-zona del shell (R.2.6).
 */
export default async function ConversationsPage({ params, searchParams }: Props) {
  const { placeSlug } = await params
  const { filter: rawFilter } = await searchParams
  const filter = parsePostListFilter(rawFilter)

  const place = await loadPlaceBySlug(placeSlug)
  if (!place) notFound()

  const viewer = await resolveViewerForPlace({ placeSlug })

  const { items, nextCursor } = await listPostsByPlace({
    placeId: place.id,
    includeHidden: viewer.isAdmin,
    viewerUserId: viewer.actorId,
    filter,
  })

  return (
    <PostList
      placeId={place.id}
      items={items}
      nextCursor={
        nextCursor ? { createdAt: nextCursor.createdAt.toISOString(), id: nextCursor.id } : null
      }
      filter={filter}
    />
  )
}
