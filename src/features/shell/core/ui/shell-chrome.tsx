'use client'

import { usePathname } from 'next/navigation'
import type { MyPlace } from '@/features/places/public'
import { TopBar } from './top-bar'
import { SectionDots, ZONES, shouldShowShellChrome } from '@/features/shell/zone-navigation/public'

/**
 * Chrome del shell (TopBar + SectionDots) con visibilidad condicional
 * según el pathname actual.
 *
 * - **TopBar** renderiza en zonas root (`/`, `/conversations`, `/events`,
 *   `/library`) y en `/settings/*` (admin necesita el community switcher).
 * - **SectionDots** renderiza SOLO en zonas root — son navegación entre
 *   las 4 zonas (Inicio/Conversaciones/Eventos/Biblioteca) y NO tienen
 *   sentido dentro de `/settings/*` (el user está en admin chrome con
 *   sidebar propio + FAB mobile). Saparlas también en sub-pages donde
 *   `shouldShowShellChrome` retorna false (todo el chrome se oculta).
 *
 * Client Component porque depende de `usePathname` para reaccionar al
 * cambio de ruta. La gating logic del chrome completo vive en
 * `shouldShowShellChrome` (pure function, testeable sin DOM). El gate
 * adicional para SectionDots-en-settings vive inline acá (es UI policy,
 * no domain logic).
 *
 * Ver `docs/features/shell/spec.md` § 4.1 (chrome conditional).
 */
const ZONE_PATHS = ZONES.map((z) => z.path)

type Props = {
  places: ReadonlyArray<MyPlace>
  currentSlug: string
  apexUrl: string
  placeClosed: boolean
}

export function ShellChrome({ places, currentSlug, apexUrl, placeClosed }: Props): React.ReactNode {
  const pathname = usePathname()
  if (!shouldShowShellChrome(pathname, ZONE_PATHS)) return null

  const inSettings = pathname === '/settings' || pathname.startsWith('/settings/')

  return (
    <>
      <TopBar places={places} currentSlug={currentSlug} apexUrl={apexUrl} />
      {inSettings ? null : <SectionDots disabled={placeClosed} />}
    </>
  )
}
