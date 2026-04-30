import { FileText, ImageIcon, Link as LinkIcon, Sheet, FileType } from 'lucide-react'
import type { DocType } from '../domain/types'

/**
 * Icon 36×36 que representa el tipo de doc en filas (`<RecentDocRow>`,
 * `<DocList>`). Cada tipo tiene su lucide icon + un fondo soft
 * tinted distintivo (sin gritar — opacidades bajas).
 *
 * Server Component puro — sin estado, sin interactividad.
 */
type Props = {
  type: DocType
  size?: number
}

const ICON_BY_TYPE: Record<DocType, typeof FileText> = {
  pdf: FileText,
  link: LinkIcon,
  image: ImageIcon,
  doc: FileType,
  sheet: Sheet,
}

const LABEL_BY_TYPE: Record<DocType, string> = {
  pdf: 'PDF',
  link: 'Link',
  image: 'Imagen',
  doc: 'Documento',
  sheet: 'Hoja de cálculo',
}

export function FileIcon({ type, size = 36 }: Props): React.ReactNode {
  const Icon = ICON_BY_TYPE[type]
  const iconSize = Math.round(size * 0.5)
  return (
    <span
      role="img"
      aria-label={LABEL_BY_TYPE[type]}
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-[10px] border-[0.5px] border-border bg-soft text-muted"
    >
      <Icon size={iconSize} aria-hidden="true" />
    </span>
  )
}
