import type { LibraryItemListView } from '@/features/library/public'
import { LibraryItemRow } from './library-item-row'

/**
 * Bento "Recientes" — top-N items globales del place ordenados por
 * `Post.lastActivityAt DESC` (R.7.6+). Aparece debajo del grid de
 * categorías en la zona Biblioteca.
 *
 * El handoff sugiere top-5; la prop `max` lo hace configurable.
 *
 * Si `items.length === 0`, retorna null — el caller (page) decide si
 * mostrar `<EmptyLibrary>` cuando todo el place está vacío.
 *
 * Server Component puro.
 */
type Props = {
  items: ReadonlyArray<LibraryItemListView>
  max?: number
}

export function RecentsList({ items, max = 5 }: Props): React.ReactNode {
  if (items.length === 0) return null
  const visible = items.slice(0, max)

  return (
    <section aria-label="Recientes" className="px-3">
      <h2 className="mb-2 font-title text-[18px] font-semibold text-text">Recientes</h2>
      <div className="overflow-hidden rounded-[18px] border-[0.5px] border-border bg-surface">
        {visible.map((item, idx) => (
          <LibraryItemRow key={item.id} item={item} hairline={idx > 0} />
        ))}
      </div>
    </section>
  )
}
