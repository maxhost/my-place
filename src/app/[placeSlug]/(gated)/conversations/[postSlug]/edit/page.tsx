import { notFound, permanentRedirect } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { EDIT_WINDOW_MS, openPostEditSession, ThreadHeaderBar } from '@/features/discussions/public'
import { PostComposerWrapper } from '@/features/discussions/composers/public'
import { findPostBySlug, resolveViewerForPlace } from '@/features/discussions/public.server'
import { hasPermission } from '@/features/members/public.server'
import { getEditorConfigForPlace } from '@/features/editor-config/public.server'
import type { LexicalDocument } from '@/features/rich-text/public'

type Props = {
  params: Promise<{ placeSlug: string; postSlug: string }>
}

// El body editable nunca debe servirse cacheado: el composer parte del
// estado fresco del post (optimistic locking por `version`).
export const dynamic = 'force-dynamic'

/**
 * Editar conversación (cierre F.4). Reusa `findPostBySlug` (no query
 * nueva — el domain `Post` ya trae body+version+author+hidden+refs).
 *
 * Patrón "streaming agresivo del shell" relajado: el gate de permiso es
 * top-level (decide notFound/redirect antes de pintar nada) porque
 * mostrar el shell de edición a quien no puede editar sería incorrecto.
 *
 * Gate (defensa en profundidad — `editPostAction` lo replica server-side):
 *  - admin/owner o grupo con `discussions:edit-post` → siempre.
 *  - autor sin permiso → solo si la ventana 60s sigue abierta Y el post
 *    no está oculto. Se abre `openPostEditSession` para el grace de 5min.
 *  - cualquier otro → `notFound()`.
 *
 * Posts derivados redirigen a su editor canónico (no se editan como
 * post crudo: perderían cover/categoría/prereq o fecha/RSVP):
 *  - libraryItem → `/library/<cat>/<slug>/edit`
 *  - event       → `/events/<id>/edit`
 *
 * El wrapper en mode edit se cablea en S2; acá va un placeholder
 * inofensivo (la ruta no está enlazada hasta S3).
 */
export default async function EditPostPage({ params }: Props) {
  const { placeSlug, postSlug } = await params

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) notFound()

  const post = await findPostBySlug(place.id, postSlug)
  if (!post) notFound()

  if (post.libraryItem) {
    permanentRedirect(`/library/${post.libraryItem.categorySlug}/${post.slug}/edit`)
  }
  if (post.event) {
    permanentRedirect(`/events/${post.event.id}/edit`)
  }

  const viewer = await resolveViewerForPlace({ placeSlug })
  const canEditAjeno =
    viewer.isAdmin || (await hasPermission(viewer.actorId, place.id, 'discussions:edit-post'))

  let session: { token: string; openedAt: string } | null = null
  if (!canEditAjeno) {
    const isAuthor = post.authorUserId !== null && post.authorUserId === viewer.actorId
    const windowOpen = Date.now() - post.createdAt.getTime() < EDIT_WINDOW_MS
    if (!isAuthor || !windowOpen || post.hiddenAt !== null) notFound()

    // Token HMAC: extiende la edición editable más allá de los 60s puros
    // (grace de 5min) — mismo patrón que comments. Admin no lo necesita.
    const opened = await openPostEditSession({ postId: post.id })
    if ('session' in opened) {
      session = { token: opened.session.token, openedAt: opened.session.openedAt }
    }
  }

  const enabledEmbeds = await getEditorConfigForPlace(place.id)

  return (
    <div className="pb-32">
      <ThreadHeaderBar backHref={`/conversations/${post.slug}?from=conversations`} />
      <div className="space-y-6 p-4 md:p-8">
        <header>
          <h1 className="font-serif text-2xl italic text-text">Editar conversación</h1>
          <p className="mt-1 text-sm text-muted">Sin apuro. Guardá cuando tenga sentido.</p>
        </header>
        <PostComposerWrapper
          mode={{
            kind: 'edit',
            postId: post.id,
            postSlug: post.slug,
            expectedVersion: post.version,
            initialTitle: post.title,
            initialDocument: post.body as LexicalDocument | null,
            session,
          }}
          placeId={place.id}
          enabledEmbeds={enabledEmbeds}
        />
      </div>
    </div>
  )
}
