'use client'

import { useEffect, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createSupabaseBrowser } from '@/shared/lib/supabase/browser'

type PresenceUser = {
  userId: string
  displayName: string
  avatarUrl: string | null
}

const MAX_AVATARS = 8

/**
 * Presencia viva del thread. Cada miembro conectado al canal `post:<id>` aparece
 * como avatar con ring verde (`--place-presence`). Se filtra al viewer (no se
 * muestra a sí mismo). Overflow visible: si hay más de 8, muestra `+N más`.
 *
 * Canal private (`{config: {private: true}}`) — policies en `realtime.messages`
 * enforcean que el viewer sea miembro activo del place del post. Ver migration
 * `20260424000000_realtime_discussions_presence` y `CLAUDE.md § Gotchas`
 * (toggle "Enable Realtime Authorization" debe estar ON).
 *
 * Heartbeat automático del socket cada ~30s; stale peers salen por `presence:leave`
 * tras ~60s. No implementamos timeout manual.
 *
 * Sin realtime (Supabase caído o WS bloqueado): subscribe devuelve CHANNEL_ERROR/
 * TIMED_OUT, setPresent se queda vacío, componente no renderiza. La lectura del
 * thread sigue funcionando.
 */
export function ThreadPresence({
  postId,
  viewer,
}: {
  postId: string
  viewer: PresenceUser
}): React.ReactNode {
  const [present, setPresent] = useState<PresenceUser[]>([])

  useEffect(() => {
    const supabase = createSupabaseBrowser()
    const channel: RealtimeChannel = supabase.channel(`post:${postId}`, {
      config: { private: true },
    })

    const syncState = () => {
      const state = channel.presenceState<PresenceUser>()
      const flat = Object.values(state).flat()
      const deduped = new Map<string, PresenceUser>()
      for (const entry of flat) {
        if (entry.userId !== viewer.userId && !deduped.has(entry.userId)) {
          deduped.set(entry.userId, entry)
        }
      }
      setPresent(Array.from(deduped.values()))
    }

    channel.on('presence', { event: 'sync' }, syncState)
    channel.on('presence', { event: 'join' }, syncState)
    channel.on('presence', { event: 'leave' }, syncState)

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          userId: viewer.userId,
          displayName: viewer.displayName,
          avatarUrl: viewer.avatarUrl,
        })
      }
    })

    return () => {
      void channel.unsubscribe()
      void supabase.removeChannel(channel)
    }
  }, [postId, viewer.userId, viewer.displayName, viewer.avatarUrl])

  if (present.length === 0) return null

  const visible = present.slice(0, MAX_AVATARS)
  const overflow = present.length - visible.length

  return (
    <div aria-live="polite" aria-label="Leyendo ahora" className="flex items-center gap-2">
      <ul className="flex -space-x-2">
        {visible.map((user) => (
          <li key={user.userId} className="list-none">
            <PresenceAvatar user={user} />
          </li>
        ))}
      </ul>
      {overflow > 0 ? <span className="text-xs text-muted">+{overflow} más</span> : null}
    </div>
  )
}

function PresenceAvatar({ user }: { user: PresenceUser }): React.ReactNode {
  const ringStyle = { boxShadow: '0 0 0 2px var(--place-presence)' }
  if (user.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarUrl}
        alt={user.displayName}
        title={user.displayName}
        className="h-8 w-8 rounded-full bg-surface object-cover"
        style={ringStyle}
      />
    )
  }
  const initial = user.displayName.trim().charAt(0).toUpperCase() || '·'
  return (
    <span
      title={user.displayName}
      aria-label={user.displayName}
      className="flex h-8 w-8 items-center justify-center rounded-full bg-soft text-xs text-muted"
      style={ringStyle}
    >
      {initial}
    </span>
  )
}
