'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  MentionPrefetchContext,
  type MentionEventResult,
  type MentionLibraryCategoryResult,
  type MentionPrefetchValue,
  type MentionUserResult,
} from '@/features/rich-text/mentions/public'
import { searchMembersByPlaceAction } from '@/features/members/public'
import { searchEventsByPlaceAction } from '@/features/events/public'
import { listLibraryCategoriesForMentionAction } from '@/features/library/public'

/**
 * Provider que prefetcha en background los 3 listados base del typeahead
 * de mentions (`@`, `/event`, `/library`) y los expone vía `MentionPrefetchContext`.
 *
 * **Vive en `discussions/composers/`** porque importa Server Actions de 3
 * slices ajenos (`members/public`, `events/public`, `library/public`); el
 * boundary `shared/ ↛ features/` impide que viva en `shared/`. El Context
 * y su hook consumer viven en `rich-text/mentions/` (sub-slice del
 * consumer `MentionPlugin`); esta asimetría producer/consumer es la única
 * forma boundary-compliant. Ver `docs/plans/2026-05-09-mention-prefetch-background.md`
 * § D2 + § D7-bis.
 *
 * Disparo del prefetch: `requestIdleCallback` con timeout 2000ms, fallback
 * `setTimeout(100)` para Safari iOS pre-18. Mismo patrón que
 * `thread-presence-lazy.tsx` (líneas 50-67) — copy-paste estructural.
 *
 * Re-fetch cada 5min: `Visibility API` + soft `setInterval(60s)` que
 * comprueba si toca refrescar. Cero consumo en tabs hidden. Ver § D5.
 */
const TTL_MS = 5 * 60 * 1000
const VISIBILITY_CHECK_MS = 60 * 1000

type Props = {
  placeId: string
  children: ReactNode
}

export function MentionPrefetchProvider({ placeId, children }: Props): ReactNode {
  const [users, setUsers] = useState<MentionUserResult[] | null>(null)
  const [events, setEvents] = useState<MentionEventResult[] | null>(null)
  const [categories, setCategories] = useState<MentionLibraryCategoryResult[] | null>(null)
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null)
  const lastFetchedAtRef = useRef<number | null>(null)
  const activeRef = useRef(true)

  const doFetch = useCallback(async (): Promise<void> => {
    const tasks: Array<Promise<unknown>> = [
      searchMembersByPlaceAction(placeId, '')
        .then((rows) => {
          if (!activeRef.current) return
          setUsers(
            rows.map((r) => ({ userId: r.userId, displayName: r.displayName, handle: r.handle })),
          )
        })
        .catch(() => {}),
      searchEventsByPlaceAction(placeId, '')
        .then((rows) => {
          if (activeRef.current) setEvents(rows)
        })
        .catch(() => {}),
      listLibraryCategoriesForMentionAction(placeId)
        .then((rows) => {
          if (activeRef.current)
            setCategories(
              rows.map((r) => ({ categoryId: r.categoryId, slug: r.slug, name: r.name })),
            )
        })
        .catch(() => {}),
    ]
    await Promise.all(tasks)
    if (activeRef.current) {
      const now = Date.now()
      lastFetchedAtRef.current = now
      setLastFetchedAt(now)
    }
  }, [placeId])

  // Prefetch idle post-mount. Reset state cuando placeId cambia (rare —
  // sólo si el shell se re-monta con otro place).
  useEffect(() => {
    activeRef.current = true
    setUsers(null)
    setEvents(null)
    setCategories(null)
    setLastFetchedAt(null)
    lastFetchedAtRef.current = null

    const win = window as Window & {
      requestIdleCallback?: (cb: IdleRequestCallback, opts?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }
    let idleHandle: number | null = null
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    if (typeof win.requestIdleCallback === 'function') {
      idleHandle = win.requestIdleCallback(() => void doFetch(), { timeout: 2000 })
    } else {
      timeoutHandle = setTimeout(() => void doFetch(), 100)
    }
    return () => {
      activeRef.current = false
      if (idleHandle !== null) win.cancelIdleCallback?.(idleHandle)
      if (timeoutHandle !== null) clearTimeout(timeoutHandle)
    }
  }, [placeId, doFetch])

  // Refresh por TTL/visibility. Soft interval 60s comprueba; cero work
  // si la tab no está visible o el TTL no se cumplió.
  useEffect(() => {
    function maybeRefresh(): void {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
      const last = lastFetchedAtRef.current
      if (last !== null && Date.now() - last < TTL_MS) return
      void doFetch()
    }
    document.addEventListener('visibilitychange', maybeRefresh)
    const interval = setInterval(maybeRefresh, VISIBILITY_CHECK_MS)
    return () => {
      document.removeEventListener('visibilitychange', maybeRefresh)
      clearInterval(interval)
    }
  }, [doFetch])

  const value = useMemo<MentionPrefetchValue>(
    () => ({ users, events, categories, refresh: doFetch, lastFetchedAt }),
    [users, events, categories, doFetch, lastFetchedAt],
  )

  return <MentionPrefetchContext.Provider value={value}>{children}</MentionPrefetchContext.Provider>
}
