import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import {
  PostComposer,
  canEditPost,
  findPostById,
  resolveViewerForPlace,
} from '@/features/discussions/public'

export const metadata: Metadata = {
  title: 'Nueva conversación',
}

type Props = {
  params: Promise<{ placeSlug: string }>
  searchParams: Promise<{ edit?: string }>
}

/**
 * Página de crear / editar Post. Sin `?edit` es el composer vacío. Con
 * `?edit=<postId>` pre-carga el post y delega al mismo `<PostComposer>` en
 * modo edit. Gate `authorOrAdmin` server-side: si el viewer no puede editar,
 * redirigimos al detalle del post (no 404, para que admin que navega por UI
 * vea el post sin romperse el flujo si perdió permiso por timing).
 */
export default async function NewOrEditPostPage({ params, searchParams }: Props) {
  const { placeSlug } = await params
  const search = await searchParams

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) notFound()

  const viewer = await resolveViewerForPlace({ placeSlug })

  if (!search.edit) {
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
        <header>
          <h1 className="font-serif text-2xl italic text-place-text">Nueva conversación</h1>
          <p className="mt-1 text-sm text-place-text-soft">
            Sin apuro. Escribí y publicá cuando tenga sentido.
          </p>
        </header>
        <PostComposer mode={{ kind: 'create', placeId: place.id }} />
      </main>
    )
  }

  const post = await findPostById(search.edit)
  if (!post || post.placeId !== place.id) notFound()

  const now = new Date()
  const canEdit = canEditPost(
    { userId: viewer.actorId, isAdmin: viewer.isAdmin },
    post.authorUserId,
    post.createdAt,
    now,
  )
  if (!canEdit) {
    redirect(`/conversations/${post.slug}`)
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="font-serif text-2xl italic text-place-text">Editar conversación</h1>
        <p className="mt-1 text-sm text-place-text-soft">
          Los cambios se marcan con «(editado)» al lado del título.
        </p>
      </header>
      <PostComposer
        mode={{
          kind: 'edit',
          postId: post.id,
          initialTitle: post.title,
          initialBody: post.body,
          expectedVersion: post.version,
          slug: post.slug,
        }}
      />
    </main>
  )
}
