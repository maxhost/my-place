/**
 * "Tag" tipográfico: emoji + label uppercase en accent. Sirve como
 * etiqueta de categoría (ej: "🎉 EVENTO") sobre un título principal,
 * o como fechas compactas dentro de cards bento.
 *
 * Versión más liviana que `<SectionHead>`: no impone semántica de
 * heading. Acepta `children` arbitrarios (ej: para combinar fecha +
 * separador + hora).
 */
import type { ReactNode } from 'react'

type OverlineTagProps = {
  children: ReactNode
  emoji?: string
  className?: string
}

export function OverlineTag({ children, emoji, className }: OverlineTagProps): React.ReactNode {
  return (
    <div
      className={[
        'flex items-center gap-1.5 font-body text-[11px] font-bold uppercase tracking-wider text-accent',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {emoji ? (
        <span aria-hidden="true" className="text-[13px]">
          {emoji}
        </span>
      ) : null}
      <span>{children}</span>
    </div>
  )
}
