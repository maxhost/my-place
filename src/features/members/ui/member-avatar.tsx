import { Avatar } from '@/shared/ui/avatar'

/**
 * Wrapper domain-specific de `Avatar`. Inyecta la member palette del
 * design system (8 colores fijos del handoff F.G) y deriva initials
 * a partir del displayName.
 *
 * `Avatar` vive en `shared/` y es agnóstico del concepto "miembro"; este
 * wrapper preserva el boundary: cualquier slice que necesite mostrar
 * un miembro lo importa via `@/features/members/public`.
 *
 * El `colorKey` es siempre el `userId` para mantener consistencia
 * cross-views (mismo color para el mismo miembro en lista, threads,
 * eventos, comentarios). Las colisiones (8 colores para hasta 150
 * miembros) son aceptables: es identidad visual, no identifier.
 */
const MEMBER_PALETTE: ReadonlyArray<string> = [
  'var(--member-1)',
  'var(--member-2)',
  'var(--member-3)',
  'var(--member-4)',
  'var(--member-5)',
  'var(--member-6)',
  'var(--member-7)',
  'var(--member-8)',
]

type MemberAvatarProps = {
  userId: string
  displayName: string
  avatarUrl?: string | null
  size?: number
  className?: string
}

export function MemberAvatar({
  userId,
  displayName,
  avatarUrl,
  size,
  className,
}: MemberAvatarProps): React.ReactNode {
  // exactOptionalPropertyTypes: spread condicional para no forwardear undefined.
  const optional: { size?: number; className?: string } = {}
  if (size !== undefined) optional.size = size
  if (className !== undefined) optional.className = className
  return (
    <Avatar
      initials={deriveInitials(displayName)}
      colorKey={userId}
      palette={MEMBER_PALETTE}
      imageUrl={avatarUrl ?? null}
      alt={displayName}
      {...optional}
    />
  )
}

/**
 * Initials a partir de "Maxi Test" → "MT". Una sola palabra → primera letra.
 * Vacío → "?" (aunque en práctica `displayName` nunca es vacío en el dominio).
 */
function deriveInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return (words[0]?.[0] ?? '?').toUpperCase()
  const first = words[0]?.[0] ?? ''
  const second = words[1]?.[0] ?? ''
  return (first + second).toUpperCase() || '?'
}
