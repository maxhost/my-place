'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { trackSettingsUsage } from '../lib/track-settings-usage'

/**
 * Client Component invisible que registra un increment en `localStorage` cada
 * vez que el pathname cambia (= cada navegación dentro de `/settings/*`).
 * Alimenta el `<FrequentlyAccessedHub>` mobile.
 *
 * Usa `usePathname()` para reactividad real: cuando Next preserva el layout
 * entre rutas hermanas, el pathname del hook SÍ se actualiza en cada nav
 * (cosa que el header server-rendered NO hace — quedaba stale).
 *
 * `currentPath` prop opcional: override para tests sin Router context.
 *
 * Render `null` (no UI propia).
 */
type Props = {
  /** Override opcional. Sin él, usa `usePathname()`. */
  currentPath?: string
}

export function SettingsUsageTracker({ currentPath }: Props): null {
  const pathname = usePathname()
  const effectivePath = currentPath ?? pathname ?? ''

  useEffect(() => {
    trackSettingsUsage(effectivePath)
  }, [effectivePath])

  return null
}
