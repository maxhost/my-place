'use client'

import { usePathname } from 'next/navigation'
import type { MyPlace } from '@/features/places/public'
import { TopBar } from './top-bar'
import { SectionDots } from './section-dots'
import { ZONES } from '../domain/zones'
import { shouldShowShellChrome } from '../domain/swiper-snap'

/**
 * Chrome del shell (TopBar + SectionDots) con visibilidad condicional
 * según el pathname actual.
 *
 * - **SÍ renderiza** en zonas root (`/`, `/conversations`, `/events`)
 *   y en `/settings/*` (admin necesita el community switcher).
 * - **NO renderiza** en sub-pages (thread detail, /m/[userId], formularios
 *   de creación, edit forms). La page tiene su propio header
 *   (`<ThreadHeaderBar>`, h1 del form, etc.) y el chrome del shell
 *   suma ruido visual sin valor.
 *
 * Client Component porque depende de `usePathname` para reaccionar al
 * cambio de ruta. La gating logic vive en `shouldShowShellChrome`
 * (pure function, testeable sin DOM).
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

  return (
    <>
      <TopBar places={places} currentSlug={currentSlug} apexUrl={apexUrl} />
      <SectionDots disabled={placeClosed} />
    </>
  )
}
