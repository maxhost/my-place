import { describe, expect, it, vi, beforeEach } from 'vitest'

const postFindMany = vi.fn()
const postReadGroupBy = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    post: {
      findMany: (...a: unknown[]) => postFindMany(...a),
    },
    postRead: {
      groupBy: (...a: unknown[]) => postReadGroupBy(...a),
    },
  },
}))

vi.mock('server-only', () => ({}))

import { listPostsByPlace } from '../server/queries'

beforeEach(() => {
  postFindMany.mockReset()
  postReadGroupBy.mockReset()
})

const snapshot = { displayName: 'Autora', avatarUrl: null }

function row(id: string, lastActivityAt: Date) {
  return {
    id,
    placeId: 'place-1',
    authorUserId: 'u-author',
    authorSnapshot: snapshot,
    title: `Post ${id}`,
    slug: `post-${id}`,
    body: null,
    createdAt: lastActivityAt,
    editedAt: null,
    hiddenAt: null,
    deletedAt: null,
    lastActivityAt,
    version: 1,
  }
}

describe('listPostsByPlace + lastReadAt', () => {
  it('sin viewerUserId no consulta PostRead y devuelve lastReadAt=null en todos', async () => {
    postFindMany.mockResolvedValue([
      row('a', new Date('2026-04-19T10:00:00Z')),
      row('b', new Date('2026-04-19T09:00:00Z')),
    ])

    const { items } = await listPostsByPlace({ placeId: 'place-1' })

    expect(postReadGroupBy).not.toHaveBeenCalled()
    expect(items).toHaveLength(2)
    expect(items[0]?.lastReadAt).toBeNull()
    expect(items[1]?.lastReadAt).toBeNull()
  })

  it('con viewerUserId adjunta el max(readAt) por postId', async () => {
    const readA = new Date('2026-04-19T11:00:00Z')
    postFindMany.mockResolvedValue([
      row('a', new Date('2026-04-19T10:00:00Z')),
      row('b', new Date('2026-04-19T09:00:00Z')),
    ])
    postReadGroupBy.mockResolvedValue([{ postId: 'a', _max: { readAt: readA } }])

    const { items } = await listPostsByPlace({
      placeId: 'place-1',
      viewerUserId: 'u-viewer',
    })

    expect(postReadGroupBy).toHaveBeenCalledWith({
      by: ['postId'],
      where: { userId: 'u-viewer', postId: { in: ['a', 'b'] } },
      _max: { readAt: true },
    })
    expect(items[0]?.lastReadAt).toEqual(readA)
    expect(items[1]?.lastReadAt).toBeNull()
  })

  it('con viewer pero sin posts no invoca groupBy', async () => {
    postFindMany.mockResolvedValue([])

    const { items } = await listPostsByPlace({
      placeId: 'place-1',
      viewerUserId: 'u-viewer',
    })

    expect(postReadGroupBy).not.toHaveBeenCalled()
    expect(items).toHaveLength(0)
  })

  it('ignora rows con _max.readAt null (viewer nunca leyó) dejando lastReadAt=null', async () => {
    postFindMany.mockResolvedValue([row('a', new Date('2026-04-19T10:00:00Z'))])
    postReadGroupBy.mockResolvedValue([{ postId: 'a', _max: { readAt: null } }])

    const { items } = await listPostsByPlace({
      placeId: 'place-1',
      viewerUserId: 'u-viewer',
    })

    expect(items[0]?.lastReadAt).toBeNull()
  })
})
