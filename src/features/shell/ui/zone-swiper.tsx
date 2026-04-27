'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Component, useEffect, useRef, type ReactNode } from 'react'
import { ZONES, deriveActiveZone, type ZoneIndex } from '../domain/zones'
import { isZoneRootPath, shouldRefreshZone } from '../domain/swiper-snap'
import { SwiperViewport } from './swiper-viewport'

/**
 * Wrapper público del swiper horizontal entre zonas (R.2.5). Vive en
 * `(gated)/layout.tsx` envolviendo `{children}`.
 *
 * Comportamiento:
 *  - **Pass-through**: si el path actual NO es zona root (sub-pages
 *    como `/conversations/[postSlug]`, `/events/[id]`, etc.), retorna
 *    `{children}` sin envolver. El swiper no actúa; navegación normal.
 *  - **Swipe activo**: si el path es zona root (`/`, `/conversations`,
 *    `/events`), monta `<SwiperViewport>` con gesture handling. El
 *    snap dispara `router.push` envuelto en `startTransition` —
 *    React mantiene el UI viejo hasta que el nuevo esté listo.
 *  - **Freshness condicional**: trackea `lastVisitedAt` por zona; si
 *    el snap apunta a una zona con > 30s sin verse, dispara
 *    `router.refresh()` extra para forzar RSC fresh.
 *  - **Per-zona scroll preservation**: `scrollByZone` Map guarda
 *    `window.scrollY` al salir de cada zona y lo restaura al volver.
 *  - **Prefetch agresivo**: `onPanStart` dispara
 *    `router.prefetch()` de las zonas vecinas para warm cache.
 *  - **TopProgressBar delayed 200ms**: indicador discreto cuando la
 *    transición demora (cache miss / RSC streaming).
 *  - **Error boundary**: si framer-motion crashea, degrada a
 *    pass-through `{children}`. Cero downtime UX.
 *
 * Ver `docs/features/shell/spec.md` § 16 y ADR
 * `docs/decisions/2026-04-26-zone-swiper.md`.
 */
export function ZoneSwiper({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <SwiperErrorBoundary fallback={children}>
      <ZoneSwiperInner>{children}</ZoneSwiperInner>
    </SwiperErrorBoundary>
  )
}

const ZONE_PATHS = ZONES.map((z) => z.path)

function ZoneSwiperInner({ children }: { children: React.ReactNode }): React.ReactNode {
  const pathname = usePathname()
  const router = useRouter()

  const lastVisitedAtRef = useRef<Map<ZoneIndex, number>>(new Map())
  const scrollByZoneRef = useRef<Map<ZoneIndex, number>>(new Map())

  const activeZone = deriveActiveZone(pathname)
  const isRoot = isZoneRootPath(pathname, ZONE_PATHS)

  // Track last visit + restore scroll cuando entra a una zona root.
  // El restore se hace en `requestAnimationFrame` para asegurar que el
  // nuevo DOM ya está pintado antes de leer/escribir scrollY.
  useEffect(() => {
    if (activeZone === null || !isRoot) return
    lastVisitedAtRef.current.set(activeZone, Date.now())

    const savedScroll = scrollByZoneRef.current.get(activeZone) ?? 0
    const raf = requestAnimationFrame(() => {
      window.scrollTo(0, savedScroll)
    })
    return () => cancelAnimationFrame(raf)
  }, [pathname, activeZone, isRoot])

  // Pass-through para sub-pages (thread detail, event detail, settings,
  // /m/[userId], etc.). El swiper no actúa.
  if (!isRoot || activeZone === null) {
    return <>{children}</>
  }

  const handleSnap = (targetIndex: ZoneIndex) => {
    const targetPath = ZONES[targetIndex]?.path
    if (!targetPath) return

    // Guardar scroll actual ANTES de navegar — al volver a esta zona,
    // se restaura desde `scrollByZoneRef`.
    scrollByZoneRef.current.set(activeZone, window.scrollY)

    const lastVisitedAt = lastVisitedAtRef.current.get(targetIndex)
    const needsRefresh = shouldRefreshZone({ lastVisitedAt, now: Date.now() })

    // Sin startTransition: queremos que `usePathname()` actualice
    // inmediato para que el dot activo de SectionDots se sincronice
    // con el snap, y que `loading.tsx` muestre el skeleton correcto
    // mientras streamea el RSC. El "hold UI viejo" de transition se
    // sintió frozen 4-12s en dev (pgbouncer high-latency); skeletons
    // explícitos son production-honest.
    router.push(targetPath, { scroll: false })
    if (needsRefresh) {
      router.refresh()
    }
  }

  const handlePanStart = () => {
    // Warm cache de vecinos al iniciar un drag — anticipa el snap
    // probable y reduce skeleton risk.
    if (activeZone > 0) {
      const prev = ZONES[activeZone - 1]?.path
      if (prev) router.prefetch(prev)
    }
    if (activeZone < ZONES.length - 1) {
      const next = ZONES[activeZone + 1]?.path
      if (next) router.prefetch(next)
    }
  }

  return (
    <SwiperViewport
      activeIndex={activeZone}
      totalZones={ZONES.length}
      onSnap={handleSnap}
      onPanStart={handlePanStart}
    >
      {children}
    </SwiperViewport>
  )
}

/**
 * Defensive boundary: si `<SwiperViewport>` (framer-motion) o el inner
 * tree crashea por edge case, degrada a pass-through `{children}` y
 * loguea el error. Los `<SectionDots>` (Link puros) siguen
 * funcionando — el user puede seguir navegando sin swipe. Sin
 * downtime UX.
 *
 * React requiere class component para Error Boundaries. Inline para
 * evitar agregar dependencia `react-error-boundary` por un solo uso.
 */
type ErrorBoundaryProps = { children: ReactNode; fallback: ReactNode }
type ErrorBoundaryState = { hasError: boolean }

class SwiperErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  override componentDidCatch(error: unknown): void {
    // pino logger es server-only; en cliente usamos console.
    // En producción el SDK de observabilidad (cuando exista) capturaría.
    console.error('[ZoneSwiper] crash, falling back to pass-through', error)
  }

  override render(): ReactNode {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}
