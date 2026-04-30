import { PageIcon } from '@/shared/ui/page-icon'

/**
 * Header de la zona Biblioteca (R.5).
 *
 * Composición unificada con home, conversaciones y eventos:
 * `<PageIcon emoji="📚" />` 44×44 + título "Biblioteca" en
 * `font-title text-[26px] font-bold tracking-[-0.6px]`.
 *
 * Padding lateral 12px (`px-3`) consistente con el resto de zonas.
 *
 * Server Component: sin estado, sin queries.
 *
 * Ver `docs/features/library/spec.md`.
 */
export function LibrarySectionHeader(): React.ReactNode {
  return (
    <header className="flex items-center gap-3 px-3 pt-6">
      <PageIcon emoji="📚" />
      <h1 className="flex-1 font-title text-[26px] font-bold tracking-[-0.6px] text-text">
        Biblioteca
      </h1>
    </header>
  )
}
