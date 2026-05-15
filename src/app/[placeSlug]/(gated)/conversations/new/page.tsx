import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { resolveViewerForPlace } from '@/features/discussions/public.server'
import { PostComposerWrapper } from '@/features/discussions/composers/public'
import { getEditorConfigForPlace } from '@/features/editor-config/public.server'

export const metadata: Metadata = {
  title: 'Nueva conversación',
}

type Props = {
  params: Promise<{ placeSlug: string }>
}

/**
 * F.4 — Página de crear conversación. Reusa `<PostComposerWrapper>` (slice
 * `discussions`, Client Component) que internamente envuelve `<PostComposer>`
 * del slice `rich-text` con `createPostAction` + resolvers de mention
 * importados de `members/events/library`.
 *
 * `enabledEmbeds`: F.5 lee `Place.editorPluginsConfig` via
 * `getEditorConfigForPlace` (cacheado por `unstable_cache` + tag).
 */
export default async function NewPostPage({ params }: Props) {
  const { placeSlug } = await params
  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) notFound()

  // Defensa en profundidad: el (gated) layout ya bloquea no-miembros, pero
  // re-validamos para evitar render inútil del composer si timing raro.
  await resolveViewerForPlace({ placeSlug })

  const enabledEmbeds = await getEditorConfigForPlace(place.id)

  return (
    <div className="space-y-6 p-4 md:p-8">
      <header>
        <h1 className="font-serif text-2xl italic text-text">Nueva conversación</h1>
        <p className="mt-1 text-sm text-muted">
          Sin apuro. Escribí y publicá cuando tenga sentido.
        </p>
      </header>
      <PostComposerWrapper
        mode={{ kind: 'create' }}
        placeId={place.id}
        enabledEmbeds={enabledEmbeds}
      />
    </div>
  )
}
