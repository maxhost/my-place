import type { MyPlace } from '@/features/places/public'
import { TopBar } from './top-bar'
import { SectionDots } from './section-dots'

/**
 * Root del shell común. Envuelve `{children}` con TopBar + SectionDots
 * + viewport. Mobile-first con `max-w-[420px] mx-auto` centrado en
 * desktop (sin breakpoints custom — el contenido queda centrado con
 * bordes laterales del `bg-bg` visibles).
 *
 * Server Component. Recibe `places` (de `listMyPlaces`) y `currentSlug`
 * (de `params.placeSlug`) como props del layout que lo monta. NO hace
 * data fetching propio.
 *
 * `apexUrl` y `apexDomain` vienen de `clientEnv.NEXT_PUBLIC_APP_URL` y
 * `NEXT_PUBLIC_APP_DOMAIN` respectivamente. El layout caller los pasa
 * para evitar acoplar el shell al `clientEnv` global (testabilidad).
 *
 * `placeClosed` opcional: si el place está cerrado (PlaceClosedView),
 * los dots se renderizan pero `disabled` (opacity 50, no clickeables).
 * El switcher y search trigger siguen accesibles.
 *
 * Ver `docs/features/shell/spec.md` § 4 (layout root) y § 10 (mount).
 */
type Props = {
  places: ReadonlyArray<MyPlace>
  currentSlug: string
  apexUrl: string
  apexDomain: string
  placeClosed?: boolean
  children: React.ReactNode
}

export function AppShell({
  places,
  currentSlug,
  apexUrl,
  apexDomain,
  placeClosed = false,
  children,
}: Props): React.ReactNode {
  return (
    <div className="mx-auto flex min-h-screen max-w-[420px] flex-col bg-bg">
      <TopBar places={places} currentSlug={currentSlug} apexUrl={apexUrl} apexDomain={apexDomain} />
      <SectionDots disabled={placeClosed} />
      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  )
}
