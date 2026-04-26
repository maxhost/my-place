import { MemberAvatar } from '@/features/members/public'
import type { ReaderForStack } from '../domain/types'

/**
 * Stack de avatares de lectores para usar en `<FeaturedThreadCard>` y
 * `<ThreadRow>` (R.6) — visualiza "estos miembros leyeron este thread"
 * de forma compacta. También usable en el detail si producto pide.
 *
 * Render (mismo patrón que `<AttendeeAvatars>` de events):
 *  - Hasta `max` avatares `<MemberAvatar>` con overlap negativo (-ml-1.5)
 *    y ring `bg-bg` para definir el corte (cada avatar "muerde" al anterior).
 *  - Si `readers.length > max`, después de los `max` avatares aparece un
 *    chip `+N` (con `bg-soft text-muted`) donde N = `readers.length - max`
 *    (los lectores extra que no entran).
 *
 * `aria-label` reporta el COUNT TOTAL (no los visibles), para que el reader
 * de pantalla comunique la magnitud real ("28 lectores"), no la visualización.
 *
 * Vive en `discussions/ui/` (no en shared/) porque consume `<MemberAvatar>`
 * — shared/ no puede importar de features/ por la regla de aislamiento
 * (architecture.md). Si en el futuro otros slices necesitan el mismo
 * patrón, evaluar extraer un primitivo en shared/ui/ que reciba la
 * palette por prop (mismo trade-off que `<AttendeeAvatars>` events vs
 * este componente — duplicación aceptable hasta tener 3+ instancias).
 *
 * Ver `docs/features/discussions/spec.md` § 21.1 (uso en list rows).
 */
type Props = {
  readers: ReadonlyArray<ReaderForStack>
  max?: number
  size?: number
}

export function ReaderStack({ readers, max = 4, size = 22 }: Props): React.ReactNode {
  if (readers.length === 0) return null

  const visible = readers.slice(0, max)
  const overflow = readers.length - visible.length

  return (
    <div className="flex items-center" aria-label={`${readers.length} lectores`}>
      {visible.map((reader, idx) => (
        <span
          key={reader.userId}
          className={['inline-flex rounded-full ring-[1.5px] ring-bg', idx > 0 ? '-ml-1.5' : '']
            .filter(Boolean)
            .join(' ')}
        >
          <MemberAvatar
            userId={reader.userId}
            displayName={reader.displayName}
            avatarUrl={reader.avatarUrl}
            size={size}
          />
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className="-ml-1.5 inline-flex items-center justify-center rounded-full bg-soft text-muted ring-[1.5px] ring-bg"
          style={{
            width: size,
            height: size,
            fontSize: Math.max(9, Math.round(size * 0.4)),
          }}
          aria-hidden="true"
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  )
}
