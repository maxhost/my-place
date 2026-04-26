import { beforeEach, describe, expect, it, vi } from 'vitest'

const postFindUnique = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    post: { findUnique: (...a: unknown[]) => postFindUnique(...a) },
  },
}))
// `queries.ts` ahora importa `findOrCreateCurrentOpening` (R.6.1) que
// arrastra el chain de hours/env. Mock evita el chain — esta suite cubre
// `findPostById/findPostBySlug` que NO usan `findOrCreateCurrentOpening`.
vi.mock('../server/place-opening', () => ({
  findOrCreateCurrentOpening: vi.fn().mockResolvedValue(null),
}))
vi.mock('server-only', () => ({}))

import { findPostById, findPostBySlug } from '../server/queries'

beforeEach(() => {
  vi.resetAllMocks()
})

/**
 * F.E Fase 6 — relación bidireccional Event↔Post.
 *
 * `findPostById` y `findPostBySlug` incluyen `Post.event` (subselección
 * `{ id, title, cancelledAt }`) para que `PostDetail` renderice el banner
 * "Conversación del evento: …" + badge "Cancelado" sin round-trips
 * adicionales.
 *
 * Estos tests verifican el contrato del shape devuelto:
 *  1. Post auto-creado por evento → `event: { id, title, cancelledAt }`.
 *  2. Post standalone → `event: null`.
 *  3. Post de evento cancelado → `event.cancelledAt: Date`.
 *  4. La query incluye `include: { event: { select: ... } }` (regression
 *     guard contra refactors que lo eliminen).
 */

const baseRow = {
  id: 'post-1',
  placeId: 'place-1',
  authorUserId: 'user-1',
  authorSnapshot: { displayName: 'Max', avatarUrl: null },
  title: 'Conversación: Asado',
  slug: 'conversacion-asado',
  body: { type: 'doc', content: [] },
  createdAt: new Date('2026-04-26T10:00:00Z'),
  editedAt: null,
  hiddenAt: null,
  lastActivityAt: new Date('2026-04-26T10:00:00Z'),
  version: 0,
}

describe('findPostBySlug + event relation (F.E Fase 6)', () => {
  it('Post auto-creado por evento → event poblado con id+title+cancelledAt', async () => {
    postFindUnique.mockResolvedValue({
      ...baseRow,
      event: {
        id: 'evt-1',
        title: 'Asado del viernes',
        cancelledAt: null,
      },
    })

    const post = await findPostBySlug('place-1', 'conversacion-asado')
    expect(post).not.toBeNull()
    expect(post?.event).toEqual({
      id: 'evt-1',
      title: 'Asado del viernes',
      cancelledAt: null,
    })
  })

  it('Post standalone (sin evento) → event = null', async () => {
    postFindUnique.mockResolvedValue({
      ...baseRow,
      event: null,
    })

    const post = await findPostBySlug('place-1', 'conversacion-asado')
    expect(post?.event).toBeNull()
  })

  it('Post de evento cancelado → event.cancelledAt presente como Date', async () => {
    const cancelledAt = new Date('2026-04-25T18:00:00Z')
    postFindUnique.mockResolvedValue({
      ...baseRow,
      event: {
        id: 'evt-cancelled',
        title: 'Evento cancelado',
        cancelledAt,
      },
    })

    const post = await findPostBySlug('place-1', 'conversacion-asado')
    expect(post?.event?.cancelledAt).toEqual(cancelledAt)
  })

  it('regression guard: la query incluye `include: { event: { select } }`', async () => {
    postFindUnique.mockResolvedValue(null)
    await findPostBySlug('place-1', 'x')

    const args = postFindUnique.mock.calls[0]?.[0] as {
      include?: { event?: { select: Record<string, boolean> } }
    }
    expect(args.include?.event).toBeDefined()
    expect(args.include?.event?.select).toMatchObject({
      id: true,
      title: true,
      cancelledAt: true,
    })
  })
})

describe('findPostById + event relation (F.E Fase 6)', () => {
  it('Post auto-creado por evento → event poblado', async () => {
    postFindUnique.mockResolvedValue({
      ...baseRow,
      event: {
        id: 'evt-2',
        title: 'Otro evento',
        cancelledAt: null,
      },
    })

    const post = await findPostById('post-1')
    expect(post?.event?.id).toBe('evt-2')
  })

  it('Post sin evento → event = null', async () => {
    postFindUnique.mockResolvedValue({ ...baseRow, event: null })
    const post = await findPostById('post-1')
    expect(post?.event).toBeNull()
  })
})
