'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/shared/ui/toaster'
import type { BroadcastSubscriber } from '@/shared/lib/realtime/client'
import { SupabaseBroadcastSubscriber } from '@/shared/lib/realtime/client'
import { createSupabaseBrowser } from '@/shared/lib/supabase/browser'

/**
 * Audit #3: client-side handler del broadcast `post_hidden`.
 *
 * Si el viewer está leyendo un post y un admin lo oculta, este componente
 * recibe el broadcast (mismo canal `post:<postId>` que ya escucha
 * `CommentRealtimeAppender` — cero conexiones nuevas), redirige a
 * `/conversations` y muestra un toast informativo.
 *
 * Sin esto, el viewer seguía viendo el post + podía crear comments inválidos
 * (con `assertPostOpenForActivity` el server tiraría, pero la UX era pésima:
 * el composer aceptaba el envío sin signal del problema). Privacidad real:
 * comments del post oculto pueden contener info que admin decidió no
 * mostrar más.
 *
 * Si el subscriber no se conecta (network/WS bloqueado), opera en
 * silent-degrade igual que `useCommentRealtime` — la única consecuencia es
 * que el viewer ve el post stale hasta refresh, no peor que pre-fix.
 *
 * Se monta paralelo a `<CommentRealtimeAppender>` en `_comments-section.tsx`
 * de conversations + library.
 */
export function PostHiddenWatcher({ postId }: { postId: string }): null {
  const router = useRouter()
  useEffect(() => {
    const subscriber = getSubscriber()
    const unsubscribe = subscriber.subscribe<{ postId: string }>(
      `post:${postId}`,
      'post_hidden',
      () => {
        toast('Este post ya no está disponible.')
        router.push('/conversations')
      },
    )
    return unsubscribe
  }, [postId, router])
  return null
}

// ---------------------------------------------------------------
// Subscriber factory con test seam — paridad con use-comment-realtime.ts
// ---------------------------------------------------------------

let _testSubscriber: BroadcastSubscriber | null = null

function getSubscriber(): BroadcastSubscriber {
  if (_testSubscriber) return _testSubscriber
  return new SupabaseBroadcastSubscriber(createSupabaseBrowser())
}

/**
 * Test-only. Igual seam que `useCommentRealtime` — los tests inyectan un
 * `FakeBroadcastSubscriber` para observar la subscripción sin abrir sockets.
 */
export function __setPostHiddenWatcherSubscriberForTests(sub: BroadcastSubscriber): void {
  _testSubscriber = sub
}

export function __resetPostHiddenWatcherSubscriberForTests(): void {
  _testSubscriber = null
}
