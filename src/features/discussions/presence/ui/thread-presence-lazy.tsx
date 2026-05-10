'use client'

import { Suspense, lazy, useEffect, useState } from 'react'

/**
 * `React.lazy` (no `next/dynamic`) — Next 15 emite `<link rel="preload">`
 * automático para chunks de `next/dynamic`, contándolos en First Load JS.
 * `React.lazy` no toca `react-loadable-manifest.json`, así que el chunk
 * con Supabase Realtime + GoTrue (~12-15 kB gzip) sólo viaja al cliente
 * después del primer paint. Ver gotcha en CLAUDE.md y patrón análogo
 * en `<CommentComposerLazy>`.
 */
const ThreadPresenceReal = lazy(() =>
  import('./thread-presence').then((m) => ({ default: m.ThreadPresence })),
)

type Viewer = {
  userId: string
  displayName: string
  avatarUrl: string | null
}

type Props = {
  postId: string
  viewer: Viewer
}

/**
 * Wrapper lazy del `<ThreadPresence>`. La presencia (avatares con ring
 * verde de los miembros leyendo ahora) NO viaja en el First Load JS —
 * carga después del paint inicial via `requestIdleCallback` (con
 * fallback a `setTimeout` cuando el browser no lo soporta, ej. Safari
 * iOS pre-18).
 *
 * UX: el thread pinta inmediato; la presencia aparece en silencio
 * unos ms después si hay otros peers conectados (cozytech: nada
 * parpadea, nada grita). Si no hay peers, el componente real
 * retorna `null` igual que antes.
 *
 * Trade-off: en navegadores muy viejos (sin `requestIdleCallback`)
 * la presencia tarda ~100ms extra en aparecer. Aceptable.
 */
export function ThreadPresenceLazy({ postId, viewer }: Props): React.JSX.Element | null {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    const win = window as Window & {
      requestIdleCallback?: (cb: IdleRequestCallback, opts?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }
    if (typeof win.requestIdleCallback === 'function') {
      const handle = win.requestIdleCallback(() => setArmed(true), { timeout: 2000 })
      return () => {
        win.cancelIdleCallback?.(handle)
      }
    }
    const timer = setTimeout(() => setArmed(true), 100)
    return () => {
      clearTimeout(timer)
    }
  }, [])

  if (!armed) return null

  return (
    <Suspense fallback={null}>
      <ThreadPresenceReal postId={postId} viewer={viewer} />
    </Suspense>
  )
}
