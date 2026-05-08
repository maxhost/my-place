import 'server-only'
import { notFound } from 'next/navigation'
import { DwellTracker, ThreadPresence } from '@/features/discussions/public'
import {
  LibraryItemHeader,
  canArchiveItem,
  type LibraryItemDetailView,
} from '@/features/library/public'
import { resolveLibraryViewer } from '@/features/library/public.server'
import type { LexicalDocument } from '@/features/rich-text/public'
import { RichTextRenderer } from '@/features/rich-text/public.server'
import { buildMentionResolvers } from '@/app/[placeSlug]/(gated)/_mention-resolvers'

type Props = {
  placeSlug: string
  placeId: string
  item: LibraryItemDetailView
}

/**
 * Streamed body del library item detail (R.7.9). Este Server Component
 * vive bajo `<Suspense>` en el page para que el shell + LibraryItemHeaderBar
 * pinten en ~150ms post-TTFB. Las queries que requieren viewer happen
 * acá: ~700ms cold (resolveLibraryViewer = actor + groupMemberships +
 * tierMemberships), pero el skeleton del page hace que el user no vea
 * pantalla en blanco.
 *
 * Maneja:
 *  - Archived item check (admin/author-only): notFound desde Suspense child
 *    causa flicker pero es caso raro de moderación, aceptable.
 *  - Render inline: chip categoría + título + meta autor (`<LibraryItemHeader>`)
 *    + body TipTap (`<RichTextRenderer>`). El item NO usa `<PostDetail>` —
 *    el item ES el thread documento canónico de biblioteca.
 *  - DwellTracker / ThreadPresence client components con viewer info.
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

  // Si está archivado: solo admin o author lo ven. Caso raro (item normalmente
  // se filtra antes de render) — flicker aceptable post-skeleton.
  const itemCtx = { authorUserId: item.authorUserId }
  if (item.archivedAt && !canArchiveItem(itemCtx, libraryViewer)) notFound()

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
            resolvers={buildMentionResolvers({ placeId })}
          />
        ) : null}
      </article>

      <div className="mx-3 mt-6 border-t-[0.5px] border-border" />
    </>
  )
}
