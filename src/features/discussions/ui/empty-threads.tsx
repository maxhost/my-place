import Link from 'next/link'
import type { PostListFilter } from '../domain/filter'

/**
 * Empty state de la lista de threads (R.6 + follow-up F.2).
 *
 * Copy y CTA contextualizados según el filter activo:
 *  - `all`: "Todavía nadie escribió" + CTA "Nueva discusión".
 *  - `unanswered`: "Todas las discusiones tienen respuesta" — sin
 *    CTA. Mensaje calmo "estás al día".
 *  - `participating`: "Todavía no participaste" — sin CTA, invita
 *    a crear/responder con tono neutro.
 *
 * Sin grito visual, sin badges de urgencia. Alineado con principios
 * "nada parpadea, nada grita" + "presencia silenciosa".
 *
 * Server Component puro.
 *
 * Ver `docs/features/discussions/spec.md` § 21.1 + § 21.4.
 */
type Props = {
  filter?: PostListFilter
}

const COPY: Record<PostListFilter, { emoji: string; title: string; subtitle: string }> = {
  all: {
    emoji: '🪶',
    title: 'Todavía nadie escribió',
    subtitle: 'Iniciá la conversación con un tema que te interese.',
  },
  unanswered: {
    emoji: '💬',
    title: 'Todas las discusiones tienen respuesta',
    subtitle: 'No hay temas sin contestar. Buena señal.',
  },
  participating: {
    emoji: '🌱',
    title: 'Todavía no participaste',
    subtitle: 'Cuando escribas un post o respondas un comentario, aparecerá acá.',
  },
}

export function EmptyThreads({ filter = 'all' }: Props): React.ReactNode {
  const copy = COPY[filter]
  return (
    <div className="mx-3 flex flex-col items-center gap-3 rounded-[18px] border-[0.5px] border-border bg-surface px-6 py-10 text-center">
      <span aria-hidden="true" className="text-4xl leading-none">
        {copy.emoji}
      </span>
      <h2 className="font-title text-[22px] font-bold text-text">{copy.title}</h2>
      <p className="max-w-[280px] font-body text-sm text-muted">{copy.subtitle}</p>
      {filter === 'all' ? (
        <Link
          href="/conversations/new"
          className="mt-2 rounded-full bg-text px-4 py-2 font-body text-[13px] font-medium text-bg hover:opacity-90 motion-safe:transition-opacity"
        >
          Nueva discusión
        </Link>
      ) : null}
    </div>
  )
}
