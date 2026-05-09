import { BackLink } from '@/shared/ui/back-button'

/**
 * Header bar sticky del item detail (R.7.9).
 *
 * Análogo a `<ThreadHeaderBar>` de discussions pero específico para
 * library. El back button es siempre un `<BackLink>` (server,
 * navegación directa) — nunca `router.back()` — para evitar el loop
 * con el redirect 308 desde `/conversations/[slug]` y porque el
 * destino canónico es la categoría, no la entry previa del history.
 *
 * Destinos:
 *  - `backHref` definido (computado SSR desde `?from=conversations` →
 *    `/conversations`) tiene precedencia.
 *  - Default: `/library/[categorySlug]` — el contexto natural del
 *    item es su categoría.
 *
 * El item es accesible vía 2 caminos:
 *  1. `/library/[cat]/[itemSlug]` (canónica).
 *  2. `/conversations/[itemSlug]` → redirect 308 a la canónica.
 *
 * Ver `docs/features/library/spec.md` § 13 y
 * `docs/decisions/2026-05-09-back-navigation-origin.md`.
 */
type Props = {
  categorySlug: string
  /** Override SSR-computado a partir del query param `?from=`. Cuando
   *  está presente, manda sobre el default `/library/[categorySlug]`. */
  backHref?: string
  /** Acciones contextuales (ItemAdminMenu) en el slot derecho. */
  rightSlot?: React.ReactNode
}

export function LibraryItemHeaderBar({
  categorySlug,
  backHref,
  rightSlot,
}: Props): React.ReactNode {
  const href = backHref ?? `/library/${categorySlug}`
  return (
    <div className="bg-bg/80 supports-[backdrop-filter]:bg-bg/70 sticky top-0 z-20 flex h-14 items-center justify-between gap-2 px-3 backdrop-blur">
      <BackLink href={href} label="Volver" />
      <div className="flex items-center gap-1">{rightSlot}</div>
    </div>
  )
}
