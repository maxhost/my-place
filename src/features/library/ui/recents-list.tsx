import type { LibraryDoc } from '../domain/types'
import { RecentDocRow } from './recent-doc-row'

/**
 * Bento "Recientes" — top-N docs globales del place ordenados por
 * `uploadedAt DESC`. Aparece debajo del grid de categorías en la
 * zona Biblioteca.
 *
 * El handoff sugiere top-5; la prop `max` lo hace configurable.
 *
 * Si `docs.length === 0`, retorna null (no renderiza el bento) —
 * el caller (page de zona) decide si mostrar `<EmptyLibrary>` cuando
 * todo el place está vacío.
 *
 * Server Component puro.
 */
type Props = {
  docs: ReadonlyArray<LibraryDoc>
  max?: number
}

export function RecentsList({ docs, max = 5 }: Props): React.ReactNode {
  if (docs.length === 0) return null
  const visible = docs.slice(0, max)

  return (
    <section aria-label="Recientes" className="px-3">
      <h2 className="mb-2 font-title text-[18px] font-semibold text-text">Recientes</h2>
      <div className="overflow-hidden rounded-[18px] border-[0.5px] border-border bg-surface">
        {visible.map((doc, idx) => (
          <RecentDocRow key={doc.id} doc={doc} hairline={idx > 0} />
        ))}
      </div>
    </section>
  )
}
