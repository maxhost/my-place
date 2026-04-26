import Image from 'next/image'

/**
 * Avatar puro (agnóstico de dominio). Puede vivir en `shared/` porque
 * desconoce el concepto "miembro": recibe `palette` por prop. El wrapper
 * `MemberAvatar` (en `features/members/public.ts`) le inyecta la paleta
 * member del place.
 *
 * Precedencia de render: `imageUrl` > initials sobre color de paleta.
 *
 * - `imageUrl` presente → `<Image>` (next/image, optimizado).
 * - `imageUrl` ausente → círculo con `initials` sobre `palette[hash(colorKey) % len]`.
 *   Sin `palette`, el background cae a `--soft` (token rebrand handoff).
 *
 * El tamaño es fijo (no responsive); usar diferentes instancias para
 * diferentes layouts. Tamaños comunes: 20 (inline), 22 (attendees),
 * 28 (lista), 40 (header thread).
 */
type AvatarProps = {
  initials: string
  size?: number
  imageUrl?: string | null
  colorKey?: string
  palette?: ReadonlyArray<string>
  alt?: string
  className?: string
}

export function Avatar({
  initials,
  size = 28,
  imageUrl,
  colorKey,
  palette,
  alt,
  className,
}: AvatarProps): React.ReactNode {
  const accessibleAlt = alt ?? initials
  const truncated = truncateInitials(initials)
  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.max(10, Math.round(size * 0.4)),
  }

  if (imageUrl) {
    return (
      <Image
        src={imageUrl}
        alt={accessibleAlt}
        width={size}
        height={size}
        className={joinClass('rounded-full object-cover', className)}
        style={baseStyle}
      />
    )
  }

  const bg = palette && colorKey ? palette[hashToIndex(colorKey, palette.length)] : 'var(--soft)'

  return (
    <span
      role="img"
      aria-label={accessibleAlt}
      className={joinClass(
        'inline-flex select-none items-center justify-center rounded-full font-body font-semibold uppercase leading-none text-text',
        className,
      )}
      style={{ ...baseStyle, backgroundColor: bg }}
    >
      {truncated}
    </span>
  )
}

/**
 * djb2 hash (determinístico, sin dependencias). Devuelve un índice
 * estable entre 0 y `len-1` para asignar color de paleta por usuario.
 */
export function hashToIndex(key: string, len: number): number {
  if (len <= 0) return 0
  let hash = 5381
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % len
}

function truncateInitials(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return '?'
  return Array.from(trimmed).slice(0, 2).join('')
}

function joinClass(...parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(' ')
}
