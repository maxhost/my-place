import Link from 'next/link'
import type { PostReader } from '../server/queries'
import { listReadersByPost } from '../server/queries'
import { findOrCreateCurrentOpening } from '../server/place-opening'

const MAX_VISIBLE = 8

/**
 * Bloque "Leyeron:" que corona el hero del thread junto a `ThreadPresence`.
 * Muestra quién leyó el post durante la apertura actual del place.
 *
 * Diferencia con `ThreadPresence`:
 * - Presence = quién está mirando AHORA (live WS, avatar con borde verde).
 * - Readers = quién leyó DURANTE LA APERTURA (persistido en `PostRead`,
 *   avatar sin borde verde).
 *
 * Contrato ontológico (`docs/ontologia/conversaciones.md § Tres`,
 * `CLAUDE.md § Sobre la comunicación`): "Los lectores son parte de la
 * conversación. Leer es una forma visible de presencia, no lurking
 * invisible."
 *
 * Render rules:
 * - `findOrCreateCurrentOpening` null (place unconfigured) → null.
 * - `listReadersByPost` vacío → null (simetría con ThreadPresence, sin
 *   texto "aún nadie leyó" — silencio coherente con "nada demanda
 *   atención").
 * - Hasta 8 avatares visibles; overflow `+N más`.
 * - Cada avatar es `<Link href="/m/<userId>" prefetch={false}>` con
 *   `aria-label={displayName}`.
 * - Viewer filtrado a nivel query — no se ve a sí mismo en la lista.
 */
export async function PostReadersBlock({
  postId,
  placeId,
  viewerUserId,
}: {
  postId: string
  placeId: string
  placeSlug: string
  viewerUserId: string
}): Promise<React.ReactNode> {
  const opening = await findOrCreateCurrentOpening(placeId)
  if (!opening) return null

  const readers = await listReadersByPost({
    postId,
    placeId,
    placeOpeningId: opening.id,
    excludeUserId: viewerUserId,
  })
  if (readers.length === 0) return null

  const visible = readers.slice(0, MAX_VISIBLE)
  const overflow = readers.length - visible.length

  return (
    <div aria-label="Lectores de la apertura" className="flex items-center gap-2">
      <span className="text-sm text-place-text-soft">Leyeron:</span>
      <ul className="flex -space-x-2">
        {visible.map((reader) => (
          <li key={reader.userId} className="list-none">
            <Link href={`/m/${reader.userId}`} prefetch={false} aria-label={reader.displayName}>
              <ReaderAvatar reader={reader} />
            </Link>
          </li>
        ))}
      </ul>
      {overflow > 0 ? <span className="text-xs text-place-text-soft">+{overflow} más</span> : null}
    </div>
  )
}

function ReaderAvatar({ reader }: { reader: PostReader }): React.ReactNode {
  if (reader.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={reader.avatarUrl}
        alt={reader.displayName}
        title={reader.displayName}
        className="h-8 w-8 rounded-full bg-place-card object-cover"
      />
    )
  }
  const initial = reader.displayName.trim().charAt(0).toUpperCase() || '·'
  return (
    <span
      title={reader.displayName}
      className="flex h-8 w-8 items-center justify-center rounded-full bg-place-card-soft text-xs text-place-text-medium"
    >
      {initial}
    </span>
  )
}
