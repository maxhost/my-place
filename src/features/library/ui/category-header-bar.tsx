import { BackButton } from '@/shared/ui/back-button'

/**
 * Header bar sticky de la sub-page de categoría
 * (`/library/[categorySlug]`).
 *
 * Sticky 56px arriba del contenido. BackButton (cuadrado 36×36
 * `rounded-[12px]`) izq con fallback a `/library` si el user llegó
 * por deep link sin history. Slot derecho opcional para acciones
 * contextuales futuras (search, sort, etc.).
 *
 * Mismo pattern visual que `<ThreadHeaderBar>` en discussions —
 * duplicación intencional para evitar cross-slice import. Si en el
 * futuro un 3er caller emerge, evaluar promover a `shared/ui/`
 * como `<DetailHeaderBar>` genérico.
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
      <BackButton fallbackHref="/library" label="Volver a Biblioteca" />
      <div className="flex items-center gap-1">{rightSlot}</div>
    </div>
  )
}
