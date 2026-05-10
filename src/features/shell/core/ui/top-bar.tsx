import type { MyPlace } from '@/features/places/public'
import { CommunitySwitcher } from '@/features/shell/community-switcher/public'
import { SearchTrigger } from './search-trigger'

/**
 * Barra superior 52px del shell. Tres slots:
 * - Logo del producto (36×36, link al inbox del user en el apex) a la
 *   izquierda.
 * - Community switcher pill al centro (flex-1).
 * - Search trigger (36×36, stub en R.2) a la derecha.
 *
 * Server Component (no necesita interactividad propia). El switcher y
 * el search trigger son sus propios client islands.
 *
 * El logo usa `<a>` (no Next `<Link>`) porque va cross-subdomain — Next
 * `<Link>` está optimizado para navegación same-app. El cross-subdomain
 * dispara reload completo, lo cual es deseado (cookie de sesión cruza
 * via apex domain).
 *
 * Ver `docs/features/shell/spec.md` § 4 (componentes).
 */
type Props = {
  places: ReadonlyArray<MyPlace>
  currentSlug: string
  apexUrl: string // ej: "http://lvh.me:3000" o "https://place.app"
}

export function TopBar({ places, currentSlug, apexUrl }: Props): React.ReactNode {
  return (
    <header className="flex h-[52px] items-center gap-2 border-b-[0.5px] border-border bg-bg px-3">
      <a
        href={apexUrl}
        aria-label="Ir al inicio del producto"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border-[0.5px] border-border bg-surface font-title text-base font-semibold text-text hover:bg-soft motion-safe:transition-colors"
      >
        P
      </a>
      <CommunitySwitcher places={places} currentSlug={currentSlug} />
      <SearchTrigger />
    </header>
  )
}
