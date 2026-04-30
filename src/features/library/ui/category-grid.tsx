import type { LibraryCategory } from '../domain/types'
import { CategoryCard } from './category-card'

/**
 * Grid 2-col de `<CategoryCard>`s en la zona Biblioteca.
 *
 * Layout (handoff library/): grid 2-col, gap 10px, padding lateral
 * 12px (consistente con el resto de zonas).
 *
 * Server Component puro. Si `categories.length === 0`, NO se monta —
 * la page caller usa `<EmptyLibrary>` en su lugar.
 */
type Props = {
  categories: ReadonlyArray<LibraryCategory>
}

export function CategoryGrid({ categories }: Props): React.ReactNode {
  if (categories.length === 0) return null
  return (
    <div className="grid grid-cols-2 gap-2.5 px-3">
      {categories.map((category) => (
        <CategoryCard key={category.id} category={category} />
      ))}
    </div>
  )
}
