import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { PostList, listPostsByPlace, resolveViewerForPlace } from '@/features/discussions/public'

type Props = { params: Promise<{ placeSlug: string }> }

/**
 * Lista de conversaciones del place. La primera página se arma SSR
 * (`listPostsByPlace` + `aggregateReactions`); `<PostList>` delega el
 * scroll extra al Client Component `LoadMorePosts`.
 *
 * Crear o editar un post vive en su propio route `/conversations/new`
 * (con `?edit=<postId>` para el modo edición). Acá sólo linkeamos.
 */
export default async function ConversationsPage({ params }: Props) {
  const { placeSlug } = await params
  const place = await loadPlaceBySlug(placeSlug)
  if (!place) notFound()

  const viewer = await resolveViewerForPlace({ placeSlug })

  const { items, nextCursor } = await listPostsByPlace({
    placeId: place.id,
    includeHidden: viewer.isAdmin,
    viewerUserId: viewer.actorId,
  })

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl italic text-place-text">Conversaciones</h1>
          <p className="mt-1 text-sm text-place-text-soft">
            Turnos editoriales del place. Sin apuro, sin scroll infinito.
          </p>
        </div>
        <Link
          href="/conversations/new"
          className="shrink-0 rounded-md bg-place-mark-bg px-3 py-2 text-sm text-place-mark-fg hover:opacity-90"
        >
          Nueva conversación
        </Link>
      </header>

      <PostList
        placeId={place.id}
        items={items}
        nextCursor={
          nextCursor ? { createdAt: nextCursor.createdAt.toISOString(), id: nextCursor.id } : null
        }
      />
    </main>
  )
}
