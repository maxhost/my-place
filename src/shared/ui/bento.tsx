/**
 * Bento layout primitives: grid 2-col + card con hero opcional. Reutilizable
 * para events, threads (potencial), library (potencial) sin acoplarse al
 * dominio.
 *
 * `BentoCard` con `hero` ocupa las 2 columnas y usa más padding. Sin `hero`,
 * ocupa 1 columna y padding compacto (alineado con tokens del handoff).
 *
 * Wrapper polimórfico via `as`: por default `<article>`, pero un consumer
 * puede pasarlo como `<Link>` (Next) o `<button>` cuando la card es
 * navegable. El tipo se mantiene laxo (`React.ElementType`) para no obligar
 * a importar tipos de Next desde shared.
 */
import type { ElementType, ReactNode } from 'react'

type BentoGridProps = {
  children: ReactNode
  className?: string
}

export function BentoGrid({ children, className }: BentoGridProps): React.ReactNode {
  return (
    <div className={['grid grid-cols-2 gap-2.5', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  )
}

type BentoCardProps = {
  hero?: boolean
  as?: ElementType
  children: ReactNode
  className?: string
} & Record<string, unknown>

export function BentoCard({
  hero = false,
  as,
  children,
  className,
  ...rest
}: BentoCardProps): React.ReactNode {
  const Tag = (as ?? 'article') as ElementType
  return (
    <Tag
      className={[
        'block rounded-card border-[0.5px] border-border bg-surface text-left',
        hero ? 'col-span-2 p-4' : 'p-3.5',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </Tag>
  )
}
