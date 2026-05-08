import 'server-only'
import {
  ItemAdminMenu,
  canArchiveItem,
  canEditItem,
  type LibraryItemDetailView,
} from '@/features/library/public'
import { resolveLibraryViewer } from '@/features/library/public.server'

type Props = {
  placeSlug: string
  item: LibraryItemDetailView
}

/**
 * Streamed rightSlot del `<LibraryItemHeaderBar>` con el kebab admin/
 * author. Vive bajo `<Suspense fallback={null}>` — mientras carga, el
 * header bar muestra sólo el back button (rightSlot vacío). Cuando
 * resuelve el viewer + permisos, el kebab aparece in-place.
 *
 * Lógica del slot:
 *  - viewer puede editar OR archivar (`canEditItem || canArchiveItem`) →
 *    `<ItemAdminMenu>`.
 *  - Caso contrario → null (sin kebab).
 *
 * `resolveLibraryViewer` está cacheado con React.cache per-request, así
 * que si `<LibraryItemContent>` ya lo disparó, esta llamada es 0 round-trips.
 */
export async function LibraryItemHeaderActions({
  placeSlug,
  item,
}: Props): Promise<React.ReactNode> {
  const { viewer: libraryViewer } = await resolveLibraryViewer({ placeSlug })

  const itemCtx = { authorUserId: item.authorUserId }
  const canEdit = canEditItem(itemCtx, libraryViewer)
  const canArchive = canArchiveItem(itemCtx, libraryViewer)

  if (!canEdit && !canArchive) return null

  return (
    <ItemAdminMenu
      itemId={item.id}
      categorySlug={item.categorySlug}
      postSlug={item.postSlug}
      canEdit={canEdit}
      canArchive={canArchive}
    />
  )
}
