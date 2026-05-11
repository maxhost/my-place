import type { MyPlace } from '@/features/places/public'
import { ShellChrome } from './shell-chrome'

/**
 * Root del shell común. Envuelve `{children}` con la columna centrada
 * + chrome conditional (TopBar + SectionDots) + viewport.
 *
 * Mobile-first con `max-w-[420px] mx-auto` centrado en desktop (sin
 * breakpoints custom — el contenido queda centrado con bordes
 * laterales del `bg-bg` visibles).
 *
 * Server Component. Recibe `places` (de `listMyPlaces`) y `currentSlug`
 * (de `params.placeSlug`) como props del layout que lo monta. NO hace
 * data fetching propio.
 *
 * `apexUrl` viene de `clientEnv.NEXT_PUBLIC_APP_URL`. El layout caller
 * lo pasa para evitar acoplar el shell al `clientEnv` global
 * (testabilidad). El subdomain de cada place lo construye internamente
 * `<CommunitySwitcher>` via `placeUrl()` (lee `NEXT_PUBLIC_APP_DOMAIN`).
 *
 * `placeClosed` opcional: si el place está cerrado (PlaceClosedView),
 * los dots se renderizan pero `disabled` (opacity 50, no clickeables).
 * El switcher y search trigger siguen accesibles.
 *
 * **Chrome conditional (R.2.6+)**: el `<ShellChrome>` Client Component
 * decide si renderizar TopBar + SectionDots según pathname. En zonas
 * root + settings: SÍ. En sub-pages (thread detail, /m/, new forms):
 * NO. Saving 80px de chrome top en thread detail era un compromise
 * documentado en discussions spec § 21.2 que ahora resolvemos.
 *
 * Ver `docs/features/shell/spec.md` § 4 (layout root) y § 10 (mount).
 */
type Props = {
  places: ReadonlyArray<MyPlace>
  currentSlug: string
  apexUrl: string
  placeClosed?: boolean
  /**
   * Libera el `max-w-[420px]` del container en desktop. Default `false`
   * (mobile-first preservado: gated zone sigue centrada en 420px).
   *
   * Cuando `true`, el shell ocupa todo el ancho disponible (con scrollbars
   * si el viewport es muy ancho). Usado por `/settings/*` para permitir el
   * sidebar 240px + content area amplio del rediseño desktop. El layout
   * padre (`[placeSlug]/layout.tsx`) decide pasar `wide={true}` cuando el
   * pathname es `/settings/...`.
   *
   * Ver `docs/plans/2026-05-10-settings-desktop-redesign.md` § "Sub-sesión
   * correctiva".
   */
  wide?: boolean
  children: React.ReactNode
}

export function AppShell({
  places,
  currentSlug,
  apexUrl,
  placeClosed = false,
  wide = false,
  children,
}: Props): React.ReactNode {
  const containerClass = wide
    ? 'mx-auto flex min-h-screen w-full flex-col bg-bg'
    : 'mx-auto flex min-h-screen max-w-[420px] flex-col bg-bg'
  return (
    <div className={containerClass}>
      <ShellChrome
        places={places}
        currentSlug={currentSlug}
        apexUrl={apexUrl}
        placeClosed={placeClosed}
      />
      <main className="flex-1 overflow-x-hidden">{children}</main>
    </div>
  )
}
