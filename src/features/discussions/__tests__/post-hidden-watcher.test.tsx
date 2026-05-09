import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

// El watcher por default construye un SupabaseBroadcastSubscriber con el
// browser client (env real). Test seam evita esa ruta — paridad con
// use-comment-realtime.test.tsx.
vi.mock('@/shared/config/env', () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  },
}))

const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}))

const toastFn = vi.fn()
vi.mock('@/shared/ui/toaster', () => ({
  toast: (msg: string) => toastFn(msg),
}))

import { FakeBroadcastSubscriber } from '@/shared/lib/realtime/client'
import {
  PostHiddenWatcher,
  __resetPostHiddenWatcherSubscriberForTests,
  __setPostHiddenWatcherSubscriberForTests,
} from '../ui/post-hidden-watcher'

describe('PostHiddenWatcher — Audit #3', () => {
  let fake: FakeBroadcastSubscriber

  beforeEach(() => {
    fake = new FakeBroadcastSubscriber()
    __setPostHiddenWatcherSubscriberForTests(fake)
    routerPush.mockReset()
    toastFn.mockReset()
  })

  afterEach(() => {
    __resetPostHiddenWatcherSubscriberForTests()
    cleanup()
  })

  it('redirige a /conversations + toast cuando llega broadcast `post_hidden`', () => {
    render(<PostHiddenWatcher postId="post-1" />)

    fake.emit('post:post-1', 'post_hidden', { postId: 'post-1' })

    expect(routerPush).toHaveBeenCalledWith('/conversations')
    expect(toastFn).toHaveBeenCalledWith('Este post ya no está disponible.')
  })

  it('NO reacciona a broadcasts de OTRO post (canal aislado por id)', () => {
    render(<PostHiddenWatcher postId="post-1" />)

    fake.emit('post:other-post', 'post_hidden', { postId: 'other-post' })

    expect(routerPush).not.toHaveBeenCalled()
    expect(toastFn).not.toHaveBeenCalled()
  })

  it('NO reacciona a otros eventos en el MISMO canal (ej: comment_created)', () => {
    render(<PostHiddenWatcher postId="post-1" />)

    fake.emit('post:post-1', 'comment_created', { comment: { id: 'c1' } })

    expect(routerPush).not.toHaveBeenCalled()
    expect(toastFn).not.toHaveBeenCalled()
  })

  it('cleanup: el unsubscribe se llama al desmontar', () => {
    const { unmount } = render(<PostHiddenWatcher postId="post-1" />)
    unmount()

    // Después de desmontar, emitir no debería disparar handler.
    fake.emit('post:post-1', 'post_hidden', { postId: 'post-1' })
    expect(routerPush).not.toHaveBeenCalled()
  })
})
