import { BackLink } from '@/shared/ui/back-button'

/**
 * Header bar sticky de la sub-page de categoría
 * (`/library/[categorySlug]`).
 *
 * Sticky 56px arriba del contenido. Back button SIEMPRE navega a
 * `/library` — usamos `<BackLink>` (server, Link directo) en lugar
 * de `<BackButton>` (client, history-aware con `router.back()`).
 *
 * Razón: si el user navegó categoría → item → back al category, el
 * history tiene el item arriba. Un `router.back()` desde el category
 * lo manda de vuelta al item, no a `/library`. El user esperaría
 * "volver a biblioteca" como acción canonical desde una categoría —
 * la URL canónica de "volver" es `/library`, no la entry previa del
 * history (que puede ser el item).
 *
 * Mismo pattern visual que `<ThreadHeaderBar>` en discussions —
 * duplicación intencional para evitar cross-slice import.
 *
 * Backdrop blur + sin border-bottom (mismo style que ThreadHeaderBar
 * post-fix 2026-04-27).
 *
 * Server Component puro.
 *
 * Ver `docs/features/library/spec.md`.
 */
type Props = {
  rightSlot?: React.ReactNode
}

export function CategoryHeaderBar({ rightSlot }: Props): React.ReactNode {
  return (
    <div className="bg-bg/80 supports-[backdrop-filter]:bg-bg/70 sticky top-0 z-20 flex h-14 items-center justify-between gap-2 px-3 backdrop-blur">
      <BackLink href="/library" label="Volver a Biblioteca" />
      <div className="flex items-center gap-1">{rightSlot}</div>
    </div>
  )
}
