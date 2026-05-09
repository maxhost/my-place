'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

/**
 * Botón "Volver" del thread detail (R.6) y otras pages que necesiten
 * un back navigation explícito.
 *
 * Dos modos de operación:
 *
 *  1. **Determinista (`href` definido)**: navega siempre a `href` con
 *     `router.push`, sin inspeccionar history. Usado cuando la page
 *     resolvió SSR el destino exacto a partir del query param `?from=`
 *     (ver `shared/lib/back-origin.ts`). Necesario para evitar caer al
 *     form `/conversations/new` cuando el user llegó desde ahí — el
 *     `router.back()` clásico pop al form recién enviado.
 *
 *  2. **History-aware (sólo `fallbackHref`)**: si hay history disponible
 *     (`window.history.length > 1`) dispara `router.back()` para
 *     preservar scroll restoration; si no, navega al `fallbackHref`.
 *
 * Visual: chip cuadrado 36×36 con bordes redondeados (radius 12),
 * `bg-surface` con `border-[0.5px] border-border`, icono
 * `ChevronLeft` lucide 18px. Hover suave a `bg-soft`. (2026-04-27:
 * pasado de `rounded-full` a `rounded-[12px]` por feedback visual —
 * matching estilo `<PageIcon>` y otros chips del shell.)
 *
 * Genérico (shared/ui): no acoplado a un dominio específico. Las pages
 * que lo monten pasan su propio destino y `label` para accesibilidad.
 *
 * Ver `docs/features/discussions/spec.md` § 21.2 (uso en thread detail) y
 * `docs/decisions/2026-05-09-back-navigation-origin.md` (origen del
 * approach `?from=` + determinista).
 */
type Props = {
  /** Destino determinista. Si está presente, ignora history y dispara
   *  `router.push(href)`. Resuelto SSR a partir del query param `?from=`. */
  href?: string
  /** Destino fallback cuando no hay `href` determinista y tampoco hay
   *  history (deep link, primera page del session). Default `/`. */
  fallbackHref?: string
  label?: string
  className?: string
}

export function BackButton({
  href,
  fallbackHref = '/',
  label = 'Volver',
  className,
}: Props): React.ReactNode {
  const router = useRouter()

  function handleClick(): void {
    if (href !== undefined) {
      router.push(href)
      return
    }
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
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border-[0.5px] border-border bg-surface text-text hover:bg-soft motion-safe:transition-colors',
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
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border-[0.5px] border-border bg-surface text-text hover:bg-soft motion-safe:transition-colors',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <ChevronLeft size={18} aria-hidden="true" />
    </Link>
  )
}
