'use client'

import { useEffect, useRef, useTransition } from 'react'
import { DWELL_THRESHOLD_MS } from '../domain/invariants'
import { markPostReadAction } from '../server/actions/reads'

type Clock = { now: () => number }

const TICK_INTERVAL_MS = 250

const realClock: Clock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
}

/**
 * Marca el `PostRead` tras 5s de visibilidad continua del thread.
 *
 * Visibilidad se mide por `document.visibilityState`: tab-switch, OS suspend y
 * PWA minimize pausan el contador; volver a enfocar lo reanuda. `IntersectionObserver`
 * sería demasiado estricto (el user que scrollea dentro del thread cuenta como
 * leyendo).
 *
 * La action corre una sola vez por mount. Si falla con `OutOfHoursError` (place
 * cerró entre page load y fire) o `NotFoundError` (post borrado), silenciamos —
 * no mostramos error porque el componente es invisible. El retry natural es el
 * próximo mount; `PostRead` es idempotente por `(postId, userId, placeOpeningId)`.
 *
 * `useTransition` en vez de `useMutation` (TanStack) porque el resto del slice
 * usa server actions directo y el codebase no tiene `QueryClientProvider` todavía.
 * Consistente con composer, reactions, load-more.
 */
export function DwellTracker({
  postId,
  threshold = DWELL_THRESHOLD_MS,
  clock = realClock,
}: {
  postId: string
  threshold?: number
  clock?: Clock
}): null {
  const [, startTransition] = useTransition()
  const firedRef = useRef(false)

  useEffect(() => {
    if (typeof document === 'undefined') return

    let accumulatedMs = 0
    let lastTickMs: number | null = null
    let intervalId: ReturnType<typeof setInterval> | null = null

    const fire = () => {
      if (firedRef.current) return
      firedRef.current = true
      const dwellMs = Math.floor(accumulatedMs)
      startTransition(() => {
        void markPostReadAction({ postId, dwellMs }).catch((err) => {
          const name = err instanceof Error ? err.name : ''
          if (name === 'OutOfHoursError' || name === 'NotFoundError') return
          console.error('markPostReadAction failed', err)
        })
      })
    }

    const startTick = () => {
      if (intervalId !== null || firedRef.current) return
      lastTickMs = clock.now()
      intervalId = setInterval(() => {
        if (firedRef.current) {
          stopTick()
          return
        }
        const now = clock.now()
        if (lastTickMs !== null) accumulatedMs += now - lastTickMs
        lastTickMs = now
        if (accumulatedMs >= threshold) {
          stopTick()
          fire()
        }
      }, TICK_INTERVAL_MS)
    }

    const stopTick = () => {
      if (intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
      }
      if (lastTickMs !== null) {
        accumulatedMs += clock.now() - lastTickMs
        lastTickMs = null
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') startTick()
      else stopTick()
    }

    if (document.visibilityState === 'visible') startTick()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (intervalId !== null) clearInterval(intervalId)
    }
  }, [postId, threshold, clock, startTransition])

  return null
}
