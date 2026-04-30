import Link from 'next/link'
import { TimeAgo } from '@/shared/ui/time-ago'
import type { LibraryDoc } from '../domain/types'
import { FileIcon } from './file-icon'

/**
 * Fila de un doc en la `<RecentsList>` (zona Biblioteca) y en
 * `<DocList>` (sub-page de categoría).
 *
 * Layout (handoff): 36×36 file icon + título 1-line clamp +
 * meta "Categoría · tiempo".
 *
 * Click → abre el doc según `type`. R.5 v1: link a la categoría
 * como fallback (la apertura real con preview/redirect/download
 * vive en R.5.X cuando exista backend con URLs reales).
 *
 * Server Component puro.
 */
type Props = {
  doc: LibraryDoc
  /** Si true, agrega border-t hairline interno (para separar rows
   *  cuando se renderiza dentro de una lista no `divide-y`). El
   *  default `<DocList>` ya provee divide-y, así que se deja `false`. */
  hairline?: boolean
}

export function RecentDocRow({ doc, hairline = false }: Props): React.ReactNode {
  return (
    <Link
      href={`/library/${doc.categorySlug}`}
      className={[
        'flex items-center gap-3 px-3 py-3 hover:bg-soft motion-safe:transition-colors',
        hairline ? 'border-t-[0.5px] border-border first:border-t-0' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <FileIcon type={doc.type} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-body text-sm font-semibold text-text">{doc.title}</p>
        <p className="mt-0.5 font-body text-[12px] text-muted">
          <span>{doc.categoryTitle}</span>
          <span aria-hidden="true"> · </span>
          <TimeAgo date={doc.uploadedAt} />
        </p>
      </div>
    </Link>
  )
}
