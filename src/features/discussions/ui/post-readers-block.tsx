import type { PostReader } from '../server/queries'
import { ReaderStack } from './reader-stack'

const MAX_VISIBLE = 5

/**
 * Bloque "X leyeron" del thread detail (R.6.4 layout). Muestra quién leyó
 * el post durante la apertura actual del place — los lectores son parte
 * de la conversación.
 *
 * Visual del handoff: stack horizontal de hasta 5 avatares con overlap
 * + label "{n} leyeron" en text-muted. Reusa `<ReaderStack>` (el mismo
 * primitivo que usan FeaturedThreadCard y ThreadRow en la lista R.6.3),
 * con `size=24` y `max=5` específicos del detail.
 *
 * **Pure Server Component**: recibe `readers` como prop. Las queries que
 * resuelven la apertura actual (`findOrCreateCurrentOpening`) y la lista
 * de lectores (`listReadersByPost`) las hace el page composer dentro de
 * su Promise.all, así el critical path no las paga secuencialmente. El
 * page filtra al viewer y maneja el caso "place sin opening" pasando
 * `readers=[]`.
 *
 * Diferencia con `ThreadPresence`:
 * - Presence = quién está mirando AHORA (live WS, avatar con borde verde).
 * - Readers = quién leyó DURANTE LA APERTURA (persistido en `PostRead`,
 *   avatar sin borde verde).
 *
 * Render rules:
 * - `readers` vacío → null (silencio coherente con "nada demanda atención";
 *   cubre tanto "place unconfigured" como "ningún lector").
 * - Hasta 5 avatares visibles; overflow `+N`.
 *
 * Ver `docs/features/discussions/spec.md` § 21.2 y `docs/ontologia/
 * conversaciones.md § Tres`.
 */
export function PostReadersBlock({ readers }: { readers: PostReader[] }): React.ReactNode {
  if (readers.length === 0) return null

  return (
    <div aria-label="Lectores de la apertura" className="flex items-center gap-2 px-3">
      <ReaderStack readers={readers} max={MAX_VISIBLE} size={24} />
      <span className="text-[13px] text-muted">{readers.length} leyeron</span>
    </div>
  )
}
