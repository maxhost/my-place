import Link from 'next/link'
import { TimeAgo } from '@/shared/ui/time-ago'
import type { LibraryItemListView } from '@/features/library/public'

/**
 * Fila de un item en `<RecentsList>` (zona Biblioteca) y `<ItemList>`
 * (sub-page de categoría) — R.7.
 *
 * Layout: chip 36×36 con emoji de la categoría + título 1-line +
 * meta "categoría · author · TimeAgo · n respuestas".
 *
 * Click → URL canónica del item `/library/[cat]/[postSlug]`.
 *
 * Server Component puro.
 */
type Props = {
  item: LibraryItemListView
  /** Border-t hairline cuando se renderiza fuera de un wrapper
   *  con `divide-y` (caso `<RecentsList>` v1). Default `false`. */
  hairline?: boolean
}

export function LibraryItemRow({ item, hairline = false }: Props): React.ReactNode {
  return (
    <Link
      href={`/library/${item.categorySlug}/${item.postSlug}`}
      className={[
        'flex items-center gap-3 px-3 py-3 hover:bg-soft motion-safe:transition-colors',
        hairline ? 'border-t-[0.5px] border-border first:border-t-0' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-bg text-xl"
      >
        {item.categoryEmoji}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-body text-sm font-semibold text-text">{item.title}</p>
        <p className="mt-0.5 truncate font-body text-[12px] text-muted">
          <span>{item.categoryTitle}</span>
          <span aria-hidden="true"> · </span>
          <span>{item.authorDisplayName}</span>
          <span aria-hidden="true"> · </span>
          <TimeAgo date={item.lastActivityAt} />
          {item.commentCount > 0 ? (
            <>
              <span aria-hidden="true"> · </span>
              <span>
                {item.commentCount === 1 ? '1 respuesta' : `${item.commentCount} respuestas`}
              </span>
            </>
          ) : null}
        </p>
      </div>
    </Link>
  )
}
