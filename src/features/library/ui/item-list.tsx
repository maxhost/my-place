import type { LibraryItemListView } from '@/features/library/public'
import { LibraryItemRow } from './library-item-row'

/**
 * Lista de items dentro de una categoría (R.7.10) — sub-page
 * `/library/[categorySlug]`.
 *
 * Reusa `<LibraryItemRow>` con divider hairline entre rows. Wrapper
 * con `mx-3` respeta el padding lateral 12px de la zona; los borders
 * y dividers también respetan el inset (mismo pattern que el listado
 * de discusiones tras el fix R.6.4).
 *
 * Si `items.length === 0`, retorna null — el caller (page) usa
 * `<EmptyItemList>` en su lugar.
 *
 * Server Component puro.
 */
type Props = {
  items: ReadonlyArray<LibraryItemListView>
}

export function ItemList({ items }: Props): React.ReactNode {
  if (items.length === 0) return null
  return (
    <div className="mx-3 divide-y divide-border overflow-hidden rounded-[18px] border-[0.5px] border-border bg-surface">
      {items.map((item) => (
        <LibraryItemRow key={item.id} item={item} />
      ))}
    </div>
  )
}
