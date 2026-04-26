'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

/**
 * Botón "Volver" del thread detail (R.6) y otras pages que necesiten
 * un back navigation explícito.
 *
 * Comportamiento: si hay history disponible (`window.history.length > 1`),
 * dispara `router.back()` para preservar la navegación natural del browser
 * (incluyendo scroll restoration). Si no hay history (deep link, primera
 * page del session), navega al `fallbackHref` con `router.push`.
 *
 * Visual: chip 36×36, `bg-surface` con `border-[0.5px] border-border`,
 * radius full, icono `ChevronLeft` lucide 18px. Hover suave a `bg-soft`.
 *
 * Genérico (shared/ui): no acoplado a un dominio específico. Las pages
 * que lo monten pasan su propio `fallbackHref` y `label` para
 * accesibilidad.
 *
 * Ver `docs/features/discussions/spec.md` § 21.2 (uso en thread detail).
 */
type Props = {
  fallbackHref?: string
  label?: string
  className?: string
}

export function BackButton({
  fallbackHref = '/',
  label = 'Volver',
  className,
}: Props): React.ReactNode {
  const router = useRouter()

  function handleClick(): void {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push(fallbackHref)
    }
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={handleClick}
      className={[
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[0.5px] border-border bg-surface text-text hover:bg-soft motion-safe:transition-colors',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <ChevronLeft size={18} aria-hidden="true" />
    </button>
  )
}

/**
 * Variante server-component fallback. Renderiza un `<Link>` directo a
 * `fallbackHref` sin lógica de history. Util cuando el caller no quiere
 * arrastrar 'use client' al server tree (ej: SSR puro de un detail page
 * que NO requiere preservar history).
 *
 * Misma forma visual que `BackButton`.
 */
export function BackLink({
  href,
  label = 'Volver',
  className,
}: {
  href: string
  label?: string
  className?: string
}): React.ReactNode {
  return (
    <Link
      href={href}
      aria-label={label}
      className={[
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[0.5px] border-border bg-surface text-text hover:bg-soft motion-safe:transition-colors',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <ChevronLeft size={18} aria-hidden="true" />
    </Link>
  )
}
