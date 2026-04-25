import { beforeEach, describe, expect, it, vi } from 'vitest'

const flagFindMany = vi.fn()
const flagCount = vi.fn()
const postFindMany = vi.fn()
const commentFindMany = vi.fn()
const eventFindMany = vi.fn()
const transactionFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    flag: {
      findMany: (...a: unknown[]) => flagFindMany(...a),
      count: (...a: unknown[]) => flagCount(...a),
    },
    post: { findMany: (...a: unknown[]) => postFindMany(...a) },
    comment: { findMany: (...a: unknown[]) => commentFindMany(...a) },
    event: { findMany: (...a: unknown[]) => eventFindMany(...a) },
    $transaction: (...a: unknown[]) => transactionFn(...a),
  },
}))
vi.mock('server-only', () => ({}))

import { countOpenFlags, listFlagTargetSnapshots, listFlagsByPlace } from '../server/queries'
import type { Flag } from '../domain/types'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('listFlagsByPlace', () => {
  it('filtra por placeId y orderBy createdAt desc por default', async () => {
    flagFindMany.mockResolvedValue([])
    await listFlagsByPlace({ placeId: 'place-1' })
    expect(flagFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ placeId: 'place-1' }),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    )
  })

  it('filtra por status si se provee', async () => {
    flagFindMany.mockResolvedValue([])
    await listFlagsByPlace({ placeId: 'place-1', status: 'OPEN' })
    expect(flagFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ placeId: 'place-1', status: 'OPEN' }),
      }),
    )
  })

  it('filtra con status array usando { in: [...] }', async () => {
    flagFindMany.mockResolvedValue([])
    await listFlagsByPlace({
      placeId: 'place-1',
      status: ['REVIEWED_ACTIONED', 'REVIEWED_DISMISSED'],
    })
    expect(flagFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          placeId: 'place-1',
          status: { in: ['REVIEWED_ACTIONED', 'REVIEWED_DISMISSED'] },
        }),
      }),
    )
  })

  it('paginación: devuelve nextCursor cuando hay más de pageSize filas', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `f-${i}`,
      targetType: 'POST' as const,
      targetId: `po-${i}`,
      placeId: 'place-1',
      reporterUserId: 'u-1',
      reason: 'SPAM' as const,
      reasonNote: null,
      status: 'OPEN' as const,
      createdAt: new Date(`2026-04-2${i}T10:00:00Z`),
      reviewedAt: null,
      reviewerAdminUserId: null,
      reviewNote: null,
    }))
    flagFindMany.mockResolvedValue(rows)
    const { items, nextCursor } = await listFlagsByPlace({
      placeId: 'place-1',
      pageSize: 2,
    })
    const second = rows[1]!
    expect(items).toHaveLength(2)
    expect(nextCursor).toEqual({ createdAt: second.createdAt, id: second.id })
  })

  it('paginación: aplica cursor como filtro OR (createdAt lt | createdAt eq + id lt)', async () => {
    flagFindMany.mockResolvedValue([])
    const cursor = { createdAt: new Date('2026-04-20T10:00:00Z'), id: 'f-x' }
    await listFlagsByPlace({ placeId: 'place-1', cursor })
    const call = flagFindMany.mock.calls[0]?.[0] as { where: { OR?: unknown[] } }
    expect(call.where.OR).toEqual([
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ])
  })

  it('mapea las rows de Prisma al dominio Flag', async () => {
    const row = {
      id: 'f-1',
      targetType: 'POST',
      targetId: 'po-1',
      placeId: 'place-1',
      reporterUserId: 'u-1',
      reason: 'SPAM',
      reasonNote: null,
      status: 'OPEN',
      createdAt: new Date('2026-04-21T10:00:00Z'),
      reviewedAt: null,
      reviewerAdminUserId: null,
      reviewNote: null,
    }
    flagFindMany.mockResolvedValue([row])
    const { items, nextCursor } = await listFlagsByPlace({ placeId: 'place-1' })
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('f-1')
    expect(nextCursor).toBeNull()
  })
})

describe('countOpenFlags', () => {
  it('devuelve 0 con place vacío', async () => {
    flagCount.mockResolvedValue(0)
    const n = await countOpenFlags('place-1')
    expect(n).toBe(0)
    expect(flagCount).toHaveBeenCalledWith({
      where: { placeId: 'place-1', status: 'OPEN' },
    })
  })

  it('devuelve el count devuelto por Prisma', async () => {
    flagCount.mockResolvedValue(3)
    const n = await countOpenFlags('place-1')
    expect(n).toBe(3)
  })
})

describe('listFlagTargetSnapshots', () => {
  it('Map vacío sin hit a DB si la lista de flags está vacía', async () => {
    const result = await listFlagTargetSnapshots([])
    expect(result.size).toBe(0)
    expect(transactionFn).not.toHaveBeenCalled()
    expect(postFindMany).not.toHaveBeenCalled()
    expect(commentFindMany).not.toHaveBeenCalled()
  })

  it('hace exactamente 2 findMany batched dentro de $transaction para mezcla POST+COMMENT', async () => {
    postFindMany.mockResolvedValue([
      {
        id: 'po-1',
        title: 'Titulo',
        body: { type: 'doc', content: [] },
        hiddenAt: null,
        deletedAt: null,
        slug: 'titulo',
      },
    ])
    commentFindMany.mockResolvedValue([
      {
        id: 'co-1',
        body: { type: 'doc', content: [] },
        deletedAt: null,
        postId: 'po-2',
        post: { slug: 'po-2-slug' },
      },
    ])
    transactionFn.mockImplementation(async (ops: unknown[]) => {
      expect(Array.isArray(ops)).toBe(true)
      expect(ops).toHaveLength(2)
      return Promise.all(ops as Promise<unknown>[])
    })

    const flags: Flag[] = [
      {
        id: 'f-1',
        targetType: 'POST',
        targetId: 'po-1',
        placeId: 'pl-1',
        reporterUserId: 'u-1',
        reason: 'SPAM',
        reasonNote: null,
        status: 'OPEN',
        createdAt: new Date(),
        reviewedAt: null,
        reviewerAdminUserId: null,
        reviewNote: null,
      },
      {
        id: 'f-2',
        targetType: 'COMMENT',
        targetId: 'co-1',
        placeId: 'pl-1',
        reporterUserId: 'u-1',
        reason: 'OFFTOPIC',
        reasonNote: null,
        status: 'OPEN',
        createdAt: new Date(),
        reviewedAt: null,
        reviewerAdminUserId: null,
        reviewNote: null,
      },
    ]

    const snapshots = await listFlagTargetSnapshots(flags)
    expect(snapshots.size).toBe(2)
    expect(snapshots.get('POST:po-1')).toMatchObject({
      targetType: 'POST',
      title: 'Titulo',
      slug: 'titulo',
    })
    expect(snapshots.get('COMMENT:co-1')).toMatchObject({
      targetType: 'COMMENT',
      postId: 'po-2',
      postSlug: 'po-2-slug',
    })
    expect(transactionFn).toHaveBeenCalledTimes(1)
  })

  it('si el target fue deleted entre flag y read, la key no aparece en el Map', async () => {
    postFindMany.mockResolvedValue([])
    commentFindMany.mockResolvedValue([])
    transactionFn.mockImplementation(async (ops: unknown[]) =>
      Promise.all(ops as Promise<unknown>[]),
    )

    const flags: Flag[] = [
      {
        id: 'f-1',
        targetType: 'POST',
        targetId: 'po-gone',
        placeId: 'pl-1',
        reporterUserId: 'u-1',
        reason: 'SPAM',
        reasonNote: null,
        status: 'OPEN',
        createdAt: new Date(),
        reviewedAt: null,
        reviewerAdminUserId: null,
        reviewNote: null,
      },
    ]

    const snapshots = await listFlagTargetSnapshots(flags)
    expect(snapshots.size).toBe(0)
    expect(snapshots.get('POST:po-gone')).toBeUndefined()
  })

  it('sólo POSTs ⇒ 1 findMany (no hace query de comments ni events)', async () => {
    postFindMany.mockResolvedValue([])
    transactionFn.mockImplementation(async (ops: unknown[]) => {
      expect(ops).toHaveLength(1)
      return Promise.all(ops as Promise<unknown>[])
    })

    const flags: Flag[] = [
      {
        id: 'f-1',
        targetType: 'POST',
        targetId: 'po-1',
        placeId: 'pl-1',
        reporterUserId: 'u-1',
        reason: 'SPAM',
        reasonNote: null,
        status: 'OPEN',
        createdAt: new Date(),
        reviewedAt: null,
        reviewerAdminUserId: null,
        reviewNote: null,
      },
    ]

    await listFlagTargetSnapshots(flags)
    expect(postFindMany).toHaveBeenCalled()
    expect(commentFindMany).not.toHaveBeenCalled()
    expect(eventFindMany).not.toHaveBeenCalled()
  })

  it('EVENT target: hace 1 findMany sobre Event y produce snapshot con title + authorSnapshot + startsAt + timezone + cancelledAt', async () => {
    eventFindMany.mockResolvedValue([
      {
        id: 'evt-1',
        title: 'Asado del viernes',
        authorSnapshot: { displayName: 'Max', avatarUrl: null },
        startsAt: new Date('2026-05-01T22:00:00Z'),
        timezone: 'America/Argentina/Buenos_Aires',
        cancelledAt: null,
      },
    ])
    transactionFn.mockImplementation(async (ops: unknown[]) => {
      expect(ops).toHaveLength(1)
      return Promise.all(ops as Promise<unknown>[])
    })

    const flags: Flag[] = [
      {
        id: 'f-evt-1',
        targetType: 'EVENT',
        targetId: 'evt-1',
        placeId: 'pl-1',
        reporterUserId: 'u-1',
        reason: 'SPAM',
        reasonNote: null,
        status: 'OPEN',
        createdAt: new Date(),
        reviewedAt: null,
        reviewerAdminUserId: null,
        reviewNote: null,
      },
    ]

    const snapshots = await listFlagTargetSnapshots(flags)
    expect(snapshots.size).toBe(1)
    expect(snapshots.get('EVENT:evt-1')).toMatchObject({
      targetType: 'EVENT',
      targetId: 'evt-1',
      title: 'Asado del viernes',
      authorSnapshot: { displayName: 'Max', avatarUrl: null },
      startsAt: '2026-05-01T22:00:00.000Z',
      timezone: 'America/Argentina/Buenos_Aires',
      cancelledAt: null,
    })
    expect(postFindMany).not.toHaveBeenCalled()
    expect(commentFindMany).not.toHaveBeenCalled()
  })

  it('EVENT cancelado: cancelledAt aparece en el snapshot como ISO string', async () => {
    const cancelledAt = new Date('2026-04-25T10:00:00Z')
    eventFindMany.mockResolvedValue([
      {
        id: 'evt-c',
        title: 'Evento cancelado',
        authorSnapshot: { displayName: 'Max', avatarUrl: null },
        startsAt: new Date('2026-05-01T22:00:00Z'),
        timezone: 'UTC',
        cancelledAt,
      },
    ])
    transactionFn.mockImplementation(async (ops: unknown[]) =>
      Promise.all(ops as Promise<unknown>[]),
    )

    const snapshots = await listFlagTargetSnapshots([
      {
        id: 'f-c',
        targetType: 'EVENT',
        targetId: 'evt-c',
        placeId: 'pl-1',
        reporterUserId: 'u-1',
        reason: 'OTHER',
        reasonNote: null,
        status: 'OPEN',
        createdAt: new Date(),
        reviewedAt: null,
        reviewerAdminUserId: null,
        reviewNote: null,
      },
    ])
    expect(snapshots.get('EVENT:evt-c')).toMatchObject({
      cancelledAt: cancelledAt.toISOString(),
    })
  })

  it('mezcla POST + COMMENT + EVENT ⇒ 3 findMany batched dentro de $transaction', async () => {
    postFindMany.mockResolvedValue([
      { id: 'po-1', title: 'p', body: { type: 'doc', content: [] }, hiddenAt: null, slug: 'p' },
    ])
    commentFindMany.mockResolvedValue([
      {
        id: 'co-1',
        body: { type: 'doc', content: [] },
        deletedAt: null,
        postId: 'po-1',
        post: { slug: 'p' },
      },
    ])
    eventFindMany.mockResolvedValue([
      {
        id: 'evt-1',
        title: 'e',
        authorSnapshot: { displayName: 'X', avatarUrl: null },
        startsAt: new Date('2026-05-01T22:00:00Z'),
        timezone: 'UTC',
        cancelledAt: null,
      },
    ])
    transactionFn.mockImplementation(async (ops: unknown[]) => {
      expect(ops).toHaveLength(3)
      return Promise.all(ops as Promise<unknown>[])
    })

    const flags: Flag[] = [
      makeFlag('f-p', 'POST', 'po-1'),
      makeFlag('f-c', 'COMMENT', 'co-1'),
      makeFlag('f-e', 'EVENT', 'evt-1'),
    ]
    const snapshots = await listFlagTargetSnapshots(flags)
    expect(snapshots.size).toBe(3)
    expect(snapshots.has('POST:po-1')).toBe(true)
    expect(snapshots.has('COMMENT:co-1')).toBe(true)
    expect(snapshots.has('EVENT:evt-1')).toBe(true)
  })
})

function makeFlag(id: string, targetType: 'POST' | 'COMMENT' | 'EVENT', targetId: string): Flag {
  return {
    id,
    targetType,
    targetId,
    placeId: 'pl-1',
    reporterUserId: 'u-1',
    reason: 'SPAM',
    reasonNote: null,
    status: 'OPEN',
    createdAt: new Date(),
    reviewedAt: null,
    reviewerAdminUserId: null,
    reviewNote: null,
  }
}
