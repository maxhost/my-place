import type { LibraryDoc } from '../domain/types'
import { RecentDocRow } from './recent-doc-row'

/**
 * Lista de docs dentro de una categoría — sub-page
 * `/library/[categorySlug]`.
 *
 * Reusa `<RecentDocRow>` con divider hairline entre rows. Wrapper
 * con `mx-3` respeta el padding lateral 12px de la zona; los
 * borders y dividers también respetan el inset (mismo pattern que
 * el listado de discusiones tras el fix R.6.4).
 *
 * Si `docs.length === 0`, retorna null — el caller (page) usa
 * `<EmptyDocList>` en su lugar.
 *
 * Server Component puro.
 */
type Props = {
  docs: ReadonlyArray<LibraryDoc>
}

export function DocList({ docs }: Props): React.ReactNode {
  if (docs.length === 0) return null
  return (
    <div className="mx-3 divide-y divide-border overflow-hidden rounded-[18px] border-[0.5px] border-border bg-surface">
      {docs.map((doc) => (
        <RecentDocRow key={doc.id} doc={doc} />
      ))}
    </div>
  )
}
