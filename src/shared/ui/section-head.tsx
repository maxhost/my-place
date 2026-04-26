/**
 * Heading discreto: emoji + meta uppercase en accent. Identifica una
 * sección dentro de una página sin "gritar" (alineado con principio
 * "nada parpadea, nada grita").
 *
 * Render como `<div role="heading" aria-level={2}>` para mantener la
 * jerarquía a11y sin fijar `<h2>` (la página puede tener múltiples
 * SectionHeads sin promoverlos a outline real).
 */
type SectionHeadProps = {
  meta: string
  emoji?: string
  className?: string
}

export function SectionHead({ meta, emoji, className }: SectionHeadProps): React.ReactNode {
  return (
    <div
      role="heading"
      aria-level={2}
      className={[
        'flex items-center gap-1.5 font-body text-xs font-bold uppercase tracking-wider text-accent',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {emoji ? (
        <span aria-hidden="true" className="text-sm">
          {emoji}
        </span>
      ) : null}
      <span>{meta}</span>
    </div>
  )
}
