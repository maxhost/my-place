import Link from 'next/link'
import type { LibraryCategory } from '../domain/types'

/**
 * Card cuadrada de una categoría — celda del `<CategoryGrid>` 2-col.
 *
 * Specs (handoff library/, ajustados 2026-04-30):
 *  - Aspect 1:1, `bg-surface`, border 0.5px, radius 18, padding 16.
 *  - Emoji 30px / line-height 1.
 *  - Espacio emoji → título: 14px (margin-bottom del emoji).
 *  - Título Inter 15/700.
 *  - Espacio título → contador: 2px (margin-top).
 *  - Count "n recursos" Inter 12.5/400 muted.
 *
 * Click → navegación a `/library/[slug]`.
 *
 * Server Component puro.
 */
type Props = {
  category: LibraryCategory
}

export function CategoryCard({ category }: Props): React.ReactNode {
  const countLabel = category.docCount === 1 ? '1 recurso' : `${category.docCount} recursos`

  return (
    <Link
      href={`/library/${category.slug}`}
      className="flex aspect-square flex-col rounded-[18px] border-[0.5px] border-border bg-surface p-4 hover:bg-soft motion-safe:transition-colors"
    >
      <span aria-hidden="true" className="mb-[14px] text-[30px] leading-none">
        {category.emoji}
      </span>
      <h3 className="font-body text-[15px] font-bold leading-tight text-text">{category.title}</h3>
      <p className="mt-[2px] font-body text-[12.5px] text-muted">{countLabel}</p>
    </Link>
  )
}
