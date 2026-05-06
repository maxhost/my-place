import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { logger } from '@/shared/lib/logger'
import { DwellTracker, ReactionBar, ThreadPresence } from '@/features/discussions/public'
import {
  aggregateReactions,
  findOrCreateCurrentOpening,
  reactionMapKey,
  type ReactionAggregationMap,
} from '@/features/discussions/public.server'
import {
  ItemAdminMenu,
  LibraryItemHeader,
  LibraryItemHeaderBar,
  canArchiveItem,
  canEditItem,
} from '@/features/library/public'
import { findItemBySlug, resolveLibraryViewer } from '@/features/library/public.server'
import { CommentsSection, CommentsSkeleton } from './_comments-section'

type Props = {
  params: Promise<{ placeSlug: string; categorySlug: string; itemSlug: string }>
}

/**
 * Detalle del item de biblioteca (R.7.9). URL canónica:
 * `/library/[categorySlug]/[itemSlug]`. El `itemSlug` URL coincide
 * con `Post.slug` — el item ES el thread documento.
 *
 * Render:
 *   - LibraryItemHeaderBar sticky (con kebab admin/author si corresponde).
 *     Específico de library (no reusa ThreadHeaderBar de discussions)
 *     porque el back button siempre debe ir a la categoría — usar
 *     router.back() rompería en items accedidos via redirect 308 desde
 *     /conversations/[slug] (loop infinito) y deep-links.
 *   - LibraryItemHeader (chip categoría + título + author + meta).
 *   - RichTextRenderer del Post.body (con embed nodes intercalados).
 *   - ReactionBar standalone sobre el Post.
 *   - PostReadersBlock + DwellTracker + ThreadPresence (reuse).
 *   - CommentThread + composer (reuse).
 *
 * Streaming: el shell (header + body + ReactionBar del POST) pinta
 * primero. Comments + readers + quoteState viven bajo `<Suspense>` en
 * `<CommentsSection>` (sibling `_comments-section.tsx`).
 *
 * Archivado: solo admin/author lo ven (RLS lo enforce + acá filtramos
 * con `canArchiveItem` para el "Archivado" badge en el header).
 *
 * Ver `docs/features/library/spec.md` § 14.9 + § 13 (cross-zona).
 */
export default async function LibraryItemDetailPage({ params }: Props) {
  const { placeSlug, categorySlug, itemSlug } = await params

  const place = await loadPlaceBySlug(placeSlug)
  if (!place) notFound()

  const [item, vctx, opening] = await Promise.all([
    findItemBySlug(place.id, categorySlug, itemSlug, { includeArchived: true }),
    resolveLibraryViewer({ placeSlug }),
    findOrCreateCurrentOpening(place.id).catch((err: unknown) => {
      logger.error({ err, placeId: place.id }, 'failed to materialize opening')
      return null
    }),
  ])
  if (!item) notFound()

  const { viewer: libraryViewer, actor: viewer } = vctx
  // Si está archivado: solo admin o author lo ven.
  const itemCtx = { authorUserId: item.authorUserId }
  if (item.archivedAt && !canArchiveItem(itemCtx, libraryViewer)) notFound()

  const canEdit = canEditItem(itemCtx, libraryViewer)
  const canArchive = canArchiveItem(itemCtx, libraryViewer)

  // Reactions del POST: solo necesitamos las reactions del propio post
  // para pintar la `<ReactionBar>` del shell. Las de los comments se
  // agregan dentro de `<CommentsSection>` junto con las del POST en una
  // sola call combinada — chiquita duplicación (1 fetch del POST acá +
  // 1 batch combinado en el suspense) a cambio de que la bar pinte sin
  // esperar el listado de comments.
  const postReactions = (await aggregateReactions({
    targets: [{ type: 'POST', id: item.postId }],
    viewerUserId: viewer.actorId,
  })) as ReactionAggregationMap

  return (
    <div className="pb-32">
      <LibraryItemHeaderBar
        categorySlug={item.categorySlug}
        rightSlot={
          canEdit || canArchive ? (
            <ItemAdminMenu
              itemId={item.id}
              categorySlug={item.categorySlug}
              postSlug={item.postSlug}
              canEdit={canEdit}
              canArchive={canArchive}
            />
          ) : null
        }
      />

      <DwellTracker postId={item.postId} />
      <ThreadPresence
        postId={item.postId}
        viewer={{
          userId: viewer.actorId,
          displayName: viewer.user.displayName,
          avatarUrl: viewer.user.avatarUrl,
        }}
      />

      <LibraryItemHeader item={item} />

      <article className="prose-place mx-3 mt-3 max-w-none text-text">
        {/* stub F.1: el RichTextRenderer (TipTap) se reemplaza en F.4. */}
        {item.body ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            Contenido temporalmente deshabilitado durante migración a Lexical (F.1). Se restaura en
            F.4.
          </div>
        ) : null}
      </article>

      <div className="mx-3 mt-6 border-t-[0.5px] border-border" />

      <div className="px-3 pt-4">
        <ReactionBar
          targetType="POST"
          targetId={item.postId}
          initial={postReactions.get(reactionMapKey('POST', item.postId)) ?? []}
        />
      </div>

      <Suspense fallback={<CommentsSkeleton />}>
        <CommentsSection
          postId={item.postId}
          placeId={place.id}
          placeSlug={viewer.placeSlug}
          viewerUserId={viewer.actorId}
          viewerIsAdmin={viewer.isAdmin}
          placeOpeningId={opening?.id ?? null}
        />
      </Suspense>
    </div>
  )
}
