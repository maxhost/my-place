import 'server-only'
import { notFound } from 'next/navigation'
import { DwellTracker, ThreadPresence } from '@/features/discussions/public'
import {
  LibraryItemHeader,
  canArchiveItem,
  type LibraryItemDetailView,
} from '@/features/library/public'
import { findLibraryCategoryBySlug, resolveLibraryViewer } from '@/features/library/public.server'
import { canOpenItem, MarkCompleteButton } from '@/features/library/courses/public'
import {
  listCategoryItemsForPrereqLookup,
  listCompletedItemIdsByUser,
} from '@/features/library/courses/public.server'
import type { LexicalDocument } from '@/features/rich-text/public'
import { RichTextRenderer } from '@/features/rich-text/public.server'
import { buildMentionResolvers } from '@/app/[placeSlug]/(gated)/_mention-resolvers'
import { LockedItemView } from './_locked-item-view'

type Props = {
  placeSlug: string
  placeId: string
  item: LibraryItemDetailView
}

/**
 * Streamed body del library item detail (R.7.9). Vive bajo `<Suspense>` en
 * el page para que el shell + LibraryItemHeaderBar pinten en ~150ms post-TTFB.
 *
 * Maneja:
 *  - Archived item check (admin/author-only).
 *  - Render del body TipTap.
 *  - DwellTracker / ThreadPresence con viewer info.
 *  - **Courses (W3 wiring 2026-05-14)**: si la categoría es `kind: COURSE`:
 *    - Carga `completedItemIds` del viewer.
 *    - Si `!canOpenItem(...)` (prereq no completado, no es owner), renderea
 *      `<LockedItemView>` en vez del body. Usa `listCategoryItemsForPrereqLookup`
 *      para resolver title + slug del prereq y mostrar CTA.
 *    - Si abierto, suma `<MarkCompleteButton>` debajo del body para que el
 *      viewer marque/desmarque la lección como completada.
 *
 * `resolveLibraryViewer` está cacheado con React.cache per-request, así
 * que `<LibraryItemHeaderActions>` (sibling Suspense) que también lo pide
 * comparte el resultado — 1 query física por request.
 *
 * Patrón "streaming agresivo del shell" — ver `docs/architecture.md`.
 */
export async function LibraryItemContent({
  placeSlug,
  placeId,
  item,
}: Props): Promise<React.ReactNode> {
  const { viewer: libraryViewer, actor: viewer } = await resolveLibraryViewer({ placeSlug })

  const itemCtx = { authorUserId: item.authorUserId }
  if (item.archivedAt && !canArchiveItem(itemCtx, libraryViewer)) notFound()

  // Detectar si la categoría es CURSO. La query es cached per-request
  // (React.cache) así que sibling Suspense la comparten.
  const category = await findLibraryCategoryBySlug(placeId, item.categorySlug)
  const isCourse = category?.kind === 'COURSE'

  // Solo cuando es CURSO: chequear si el viewer puede abrir el item +
  // cargar el set de completados (para el botón Mark Complete).
  let blocked = false
  let prereqMeta: { title: string; postSlug: string } | null = null
  let isCompleted = false
  if (isCourse) {
    const completedIds = await listCompletedItemIdsByUser(viewer.actorId, placeId)
    isCompleted = completedIds.includes(item.id)
    blocked = !canOpenItem({ prereqItemId: item.prereqItemId }, libraryViewer, completedIds)

    if (blocked && item.prereqItemId !== null) {
      // Resolver title + slug del prereq desde la lista de items siblings.
      // 1 query batch — evita findUnique extra del prereq individual.
      const siblings = await listCategoryItemsForPrereqLookup(item.categoryId, placeId)
      const prereq = siblings.find((s) => s.id === item.prereqItemId)
      prereqMeta = prereq ? { title: prereq.title, postSlug: prereq.postSlug } : null
    }
  }

  if (blocked) {
    return <LockedItemView item={item} prereq={prereqMeta} />
  }

  return (
    <>
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
        {item.body ? (
          <RichTextRenderer
            document={item.body as LexicalDocument}
            resolvers={buildMentionResolvers({
              placeId,
              currentBackHref: `/library/${item.categorySlug}/${item.postSlug}`,
            })}
          />
        ) : null}
      </article>

      {isCourse ? (
        <div className="mx-3 mt-6 flex justify-start">
          <MarkCompleteButton itemId={item.id} completed={isCompleted} />
        </div>
      ) : null}

      <div className="mx-3 mt-6 border-t-[0.5px] border-border" />
    </>
  )
}
