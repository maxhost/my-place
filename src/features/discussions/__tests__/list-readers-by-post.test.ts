import { beforeEach, describe, expect, it, vi } from 'vitest'

const postReadFindMany = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    postRead: {
      findMany: (...args: unknown[]) => postReadFindMany(...args),
    },
  },
}))

vi.mock('server-only', () => ({}))

import { listReadersByPost } from '../server/queries'

beforeEach(() => {
  postReadFindMany.mockReset()
})

describe('listReadersByPost', () => {
  it('devuelve array vacío cuando no hay lectores', async () => {
    postReadFindMany.mockResolvedValue([])
    const result = await listReadersByPost({
      postId: 'post-1',
      placeId: 'place-1',
      placeOpeningId: 'opening-1',
    })
    expect(result).toEqual([])
  })

  it('mapea filas Prisma al shape PostReader con datos del user', async () => {
    postReadFindMany.mockResolvedValue([
      {
        userId: 'user-1',
        readAt: new Date('2026-04-22T20:00:00Z'),
        user: { displayName: 'Max', avatarUrl: 'https://cdn/a.png' },
      },
      {
        userId: 'user-2',
        readAt: new Date('2026-04-22T19:45:00Z'),
        user: { displayName: 'Lucía', avatarUrl: null },
      },
    ])

    const result = await listReadersByPost({
      postId: 'post-1',
      placeId: 'place-1',
      placeOpeningId: 'opening-1',
    })

    expect(result).toEqual([
      {
        userId: 'user-1',
        displayName: 'Max',
        avatarUrl: 'https://cdn/a.png',
        readAt: new Date('2026-04-22T20:00:00Z'),
      },
      {
        userId: 'user-2',
        displayName: 'Lucía',
        avatarUrl: null,
        readAt: new Date('2026-04-22T19:45:00Z'),
      },
    ])
  })

  it('filtra por (postId, placeOpeningId) en la query', async () => {
    postReadFindMany.mockResolvedValue([])

    await listReadersByPost({
      postId: 'post-abc',
      placeId: 'place-xyz',
      placeOpeningId: 'opening-123',
    })

    expect(postReadFindMany).toHaveBeenCalledTimes(1)
    const args = postReadFindMany.mock.calls[0]![0] as {
      where: Record<string, unknown>
    }
    expect(args.where).toMatchObject({
      postId: 'post-abc',
      placeOpeningId: 'opening-123',
    })
  })

  it('aplica filtro de ex-miembros: query requiere Membership activa del lector en el place', async () => {
    postReadFindMany.mockResolvedValue([])

    await listReadersByPost({
      postId: 'post-1',
      placeId: 'place-1',
      placeOpeningId: 'opening-1',
    })

    const args = postReadFindMany.mock.calls[0]![0] as {
      where: {
        user: { memberships: { some: Record<string, unknown> } }
      }
    }
    expect(args.where.user.memberships.some).toEqual({
      placeId: 'place-1',
      leftAt: null,
    })
  })

  it('excluye al viewer cuando se pasa excludeUserId', async () => {
    postReadFindMany.mockResolvedValue([])

    await listReadersByPost({
      postId: 'post-1',
      placeId: 'place-1',
      placeOpeningId: 'opening-1',
      excludeUserId: 'viewer-user',
    })

    const args = postReadFindMany.mock.calls[0]![0] as {
      where: { userId: { not: string } }
    }
    expect(args.where.userId).toEqual({ not: 'viewer-user' })
  })

  it('sin excludeUserId: no filtra userId (todos los lectores excepto ex-miembros)', async () => {
    postReadFindMany.mockResolvedValue([])

    await listReadersByPost({
      postId: 'post-1',
      placeId: 'place-1',
      placeOpeningId: 'opening-1',
    })

    const args = postReadFindMany.mock.calls[0]![0] as {
      where: { userId?: unknown }
    }
    expect(args.where.userId).toBeUndefined()
  })

  it('orden: readAt DESC (lector más reciente primero)', async () => {
    postReadFindMany.mockResolvedValue([])

    await listReadersByPost({
      postId: 'post-1',
      placeId: 'place-1',
      placeOpeningId: 'opening-1',
    })

    const args = postReadFindMany.mock.calls[0]![0] as {
      orderBy: Record<string, string>
    }
    expect(args.orderBy).toEqual({ readAt: 'desc' })
  })

  it('select: incluye displayName y avatarUrl del user join', async () => {
    postReadFindMany.mockResolvedValue([])

    await listReadersByPost({
      postId: 'post-1',
      placeId: 'place-1',
      placeOpeningId: 'opening-1',
    })

    const args = postReadFindMany.mock.calls[0]![0] as {
      select: {
        userId: boolean
        readAt: boolean
        user: { select: { displayName: boolean; avatarUrl: boolean } }
      }
    }
    expect(args.select).toEqual({
      userId: true,
      readAt: true,
      user: { select: { displayName: true, avatarUrl: true } },
    })
  })
})
