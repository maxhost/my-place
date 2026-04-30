import Link from 'next/link'
import type { LibraryCategory } from '../domain/types'

/**
 * Card cuadrada de una categoría — celda del `<CategoryGrid>` 2-col.
 *
 * Layout (handoff library/):
 *  - Aspect 1:1, `bg-surface`, border 0.5px, radius 18, padding 16.
 *  - Emoji 36px arriba-izquierda.
 *  - Título Fraunces 17/600 abajo.
 *  - Count "n documentos" Inter 12.5/400 muted, debajo del título.
 *
 * Click → navegación a `/library/[slug]`.
 *
 * Server Component puro.
 */
type Props = {
  category: LibraryCategory
}

export function CategoryCard({ category }: Props): React.ReactNode {
  const countLabel = category.docCount === 1 ? '1 documento' : `${category.docCount} documentos`

  return (
    <Link
      href={`/library/${category.slug}`}
      className="flex aspect-square flex-col justify-between rounded-[18px] border-[0.5px] border-border bg-surface p-4 hover:bg-soft motion-safe:transition-colors"
    >
      <span aria-hidden="true" className="text-[36px] leading-none">
        {category.emoji}
      </span>
      <div>
        <h3 className="font-title text-[17px] font-semibold leading-tight text-text">
          {category.title}
        </h3>
        <p className="mt-0.5 font-body text-[12.5px] text-muted">{countLabel}</p>
      </div>
    </Link>
  )
}
