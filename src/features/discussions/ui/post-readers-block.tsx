import Link from 'next/link'
import type { PostReader } from '../server/queries'

const MAX_VISIBLE = 8

/**
 * Bloque "Leyeron:" que corona el hero del thread junto a `ThreadPresence`.
 * Muestra quién leyó el post durante la apertura actual del place.
 *
 * **Pure Server Component**: recibe `readers` como prop. Las queries que
 * resuelven la apertura actual (`findOrCreateCurrentOpening`) y la lista
 * de lectores (`listReadersByPost`) las hace el page composer
 * (`/conversations/[postSlug]/page.tsx`) dentro de su Promise.all, así
 * el critical path no las paga secuencialmente al final del request
 * (mejora de performance ~2 RTT). El page filtra al viewer y maneja el
 * caso "place sin opening" pasando `readers=[]`.
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
 * - `readers` vacío → null (silencio coherente con "nada demanda
 *   atención"; cubre tanto "place unconfigured" como "ningún lector").
 * - Hasta 8 avatares visibles; overflow `+N más`.
 * - Cada avatar es `<Link href="/m/<userId>" prefetch={false}>` con
 *   `aria-label={displayName}`.
 */
export function PostReadersBlock({ readers }: { readers: PostReader[] }): React.ReactNode {
  if (readers.length === 0) return null

  const visible = readers.slice(0, MAX_VISIBLE)
  const overflow = readers.length - visible.length

  return (
    <div aria-label="Lectores de la apertura" className="flex items-center gap-2">
      <span className="text-sm text-muted">Leyeron:</span>
      <ul className="flex -space-x-2">
        {visible.map((reader) => (
          <li key={reader.userId} className="list-none">
            <Link href={`/m/${reader.userId}`} prefetch={false} aria-label={reader.displayName}>
              <ReaderAvatar reader={reader} />
            </Link>
          </li>
        ))}
      </ul>
      {overflow > 0 ? <span className="text-xs text-muted">+{overflow} más</span> : null}
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
        className="h-8 w-8 rounded-full bg-surface object-cover"
      />
    )
  }
  const initial = reader.displayName.trim().charAt(0).toUpperCase() || '·'
  return (
    <span
      title={reader.displayName}
      className="flex h-8 w-8 items-center justify-center rounded-full bg-soft text-xs text-muted"
    >
      {initial}
    </span>
  )
}
