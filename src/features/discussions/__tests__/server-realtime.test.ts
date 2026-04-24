import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerWarn, loggerDebug, getBroadcastFlag } = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  loggerDebug: vi.fn(),
  // Getter dinámico: el test controla el valor con `getBroadcastFlag.mockReturnValue(...)`
  // por caso. Simula `serverEnv.DISCUSSIONS_BROADCAST_ENABLED` con cache bypass
  // (el Proxy real cachea después del primer read; acá cada lectura es fresh).
  getBroadcastFlag: vi.fn<() => 'true' | 'false' | undefined>(),
}))

vi.mock('@/shared/lib/logger', () => ({
  logger: { warn: loggerWarn, debug: loggerDebug, info: vi.fn(), error: vi.fn() },
}))

// El sender-provider importa SupabaseBroadcastSender → clientEnv → parsea env en
// boot. En tests no queremos ese path: mockeamos `clientEnv` + `serverEnv` con
// getters dinámicos para que el código bajo test lea valores controlados sin
// disparar el Proxy real del env.
vi.mock('@/shared/config/env', () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  },
  serverEnv: new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'DISCUSSIONS_BROADCAST_ENABLED') return getBroadcastFlag()
        return undefined
      },
    },
  ),
}))

import { FakeBroadcastSender } from '@/shared/lib/realtime/server'
import { resetBroadcastSender, setBroadcastSender } from '@/shared/lib/realtime/sender-provider'

import { broadcastNewComment } from '../server/realtime'
import type { CommentView } from '../server/queries'

const baseComment: CommentView = {
  id: 'c-1',
  postId: 'post-1',
  placeId: 'place-1',
  authorUserId: 'user-1',
  authorSnapshot: { displayName: 'Max', avatarUrl: null },
  body: { type: 'doc', content: [{ type: 'paragraph' }] },
  quotedCommentId: null,
  quotedSnapshot: null,
  createdAt: new Date('2026-04-22T12:00:00Z'),
  editedAt: null,
  deletedAt: null,
  version: 0,
}

describe('broadcastNewComment', () => {
  let fake: FakeBroadcastSender

  beforeEach(() => {
    getBroadcastFlag.mockReturnValue('true')
    fake = new FakeBroadcastSender()
    setBroadcastSender(fake)
    loggerWarn.mockReset()
    loggerDebug.mockReset()
  })

  afterEach(() => {
    resetBroadcastSender()
  })

  it('emite sobre topic `post:<id>` con event `comment_created` y payload {comment}', async () => {
    await broadcastNewComment('post-abc', { comment: baseComment })

    expect(fake.captures).toHaveLength(1)
    expect(fake.lastCapture).toMatchObject({
      topic: 'post:post-abc',
      event: 'comment_created',
      payload: { comment: expect.objectContaining({ id: 'c-1' }) },
    })
  })

  it('feature flag DISCUSSIONS_BROADCAST_ENABLED=false desactiva la emisión', async () => {
    getBroadcastFlag.mockReturnValue('false')

    await broadcastNewComment('post-abc', { comment: baseComment })

    expect(fake.captures).toHaveLength(0)
    expect(loggerDebug).toHaveBeenCalled()
    const logCall = loggerDebug.mock.calls[0]![0]
    expect(logCall).toMatchObject({ event: 'commentBroadcastDisabled' })
  })

  it('ausencia del env var = flag ON por default (rollback explícito)', async () => {
    getBroadcastFlag.mockReturnValue(undefined)

    await broadcastNewComment('post-abc', { comment: baseComment })

    expect(fake.captures).toHaveLength(1)
  })

  it('error del sender NO propaga: se traga y logea warn', async () => {
    const failingFake = new FakeBroadcastSender({ failMode: true })
    setBroadcastSender(failingFake)

    await expect(broadcastNewComment('post-abc', { comment: baseComment })).resolves.toBeUndefined()

    expect(loggerWarn).toHaveBeenCalled()
    const logCall = loggerWarn.mock.calls[0]![0]
    expect(logCall).toMatchObject({ event: 'commentBroadcastFailed' })
  })

  it('éxito: log debug `commentBroadcastEmitted` con postId y commentId', async () => {
    await broadcastNewComment('post-xyz', { comment: baseComment })

    expect(loggerDebug).toHaveBeenCalled()
    const emitted = loggerDebug.mock.calls.find(
      (args) => (args[0] as { event?: string }).event === 'commentBroadcastEmitted',
    )
    expect(emitted).toBeDefined()
    expect(emitted![0]).toMatchObject({
      event: 'commentBroadcastEmitted',
      postId: 'post-xyz',
      commentId: 'c-1',
    })
  })
})
