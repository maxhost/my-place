import { describe, expect, it, vi, beforeEach } from 'vitest'

const postFindMany = vi.fn()
const postReadGroupBy = vi.fn()
const postReadFindMany = vi.fn()
const commentGroupBy = vi.fn()
const findOrCreateOpeningMock = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    post: {
      findMany: (...a: unknown[]) => postFindMany(...a),
    },
    postRead: {
      groupBy: (...a: unknown[]) => postReadGroupBy(...a),
      findMany: (...a: unknown[]) => postReadFindMany(...a),
    },
    comment: {
      groupBy: (...a: unknown[]) => commentGroupBy(...a),
    },
  },
}))

vi.mock('../server/place-opening', () => ({
  findOrCreateCurrentOpening: (...a: unknown[]) => findOrCreateOpeningMock(...a),
}))

vi.mock('server-only', () => ({}))

import { listPostsByPlace } from '../server/queries'

beforeEach(() => {
  postFindMany.mockReset()
  postReadGroupBy.mockReset()
  postReadFindMany.mockReset()
  commentGroupBy.mockReset()
  findOrCreateOpeningMock.mockReset()
  // Default: no opening (places sin hours configurada). Tests específicos
  // de readers la sobrescriben.
  findOrCreateOpeningMock.mockResolvedValue(null)
  // Default: cero comments por post.
  commentGroupBy.mockResolvedValue([])
})

const snapshot = { displayName: 'Autora', avatarUrl: null }

function row(id: string, lastActivityAt: Date, body: unknown = null) {
  return {
    id,
    placeId: 'place-1',
    authorUserId: 'u-author',
    authorSnapshot: snapshot,
    title: `Post ${id}`,
    slug: `post-${id}`,
    body,
    createdAt: lastActivityAt,
    editedAt: null,
    hiddenAt: null,
    deletedAt: null,
    lastActivityAt,
    version: 1,
  }
}

describe('listPostsByPlace + lastReadAt', () => {
  it('sin viewerUserId no consulta PostRead.groupBy y devuelve lastReadAt=null en todos', async () => {
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

describe('listPostsByPlace + R.6 shape (snippet, commentCount, readerSample, isFeatured)', () => {
  const docHello = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hola mundo' }] }],
  }

  it('snippet vacío cuando body es null', async () => {
    postFindMany.mockResolvedValue([row('a', new Date('2026-04-19T10:00:00Z'), null)])

    const { items } = await listPostsByPlace({ placeId: 'place-1' })

    expect(items[0]?.snippet).toBe('')
  })

  it('snippet derivado de richTextExcerpt(body, 140) cuando body presente', async () => {
    postFindMany.mockResolvedValue([row('a', new Date('2026-04-19T10:00:00Z'), docHello)])

    const { items } = await listPostsByPlace({ placeId: 'place-1' })

    expect(items[0]?.snippet).toBe('Hola mundo')
  })

  it('commentCount = 0 cuando comment.groupBy devuelve vacío', async () => {
    postFindMany.mockResolvedValue([row('a', new Date('2026-04-19T10:00:00Z'))])
    commentGroupBy.mockResolvedValue([])

    const { items } = await listPostsByPlace({ placeId: 'place-1' })

    expect(items[0]?.commentCount).toBe(0)
  })

  it('commentCount mapea desde groupBy (excluye soft-deleted via filtro deletedAt:null)', async () => {
    postFindMany.mockResolvedValue([
      row('a', new Date('2026-04-19T10:00:00Z')),
      row('b', new Date('2026-04-19T09:00:00Z')),
    ])
    commentGroupBy.mockResolvedValue([
      { postId: 'a', _count: { id: 5 } },
      { postId: 'b', _count: { id: 0 } },
    ])

    const { items } = await listPostsByPlace({ placeId: 'place-1' })

    expect(commentGroupBy).toHaveBeenCalledWith({
      by: ['postId'],
      where: { postId: { in: ['a', 'b'] }, deletedAt: null },
      _count: { id: true },
    })
    expect(items[0]?.commentCount).toBe(5)
    expect(items[1]?.commentCount).toBe(0)
  })

  it('readerSample vacío cuando place no tiene opening activa', async () => {
    findOrCreateOpeningMock.mockResolvedValue(null)
    postFindMany.mockResolvedValue([row('a', new Date('2026-04-19T10:00:00Z'))])

    const { items } = await listPostsByPlace({ placeId: 'place-1' })

    expect(postReadFindMany).not.toHaveBeenCalled()
    expect(items[0]?.readerSample).toEqual([])
  })

  it('readerSample top 4 por post de la opening actual', async () => {
    findOrCreateOpeningMock.mockResolvedValue({ id: 'opening-1' })
    postFindMany.mockResolvedValue([row('a', new Date('2026-04-19T10:00:00Z'))])
    postReadFindMany.mockResolvedValue([
      // 6 readers para post 'a' — el query no limita a 4 client-side; el
      // map filter sí. Verifica que solo los primeros 4 quedan en el sample.
      { postId: 'a', userId: 'u1', user: { displayName: 'Uno', avatarUrl: null } },
      { postId: 'a', userId: 'u2', user: { displayName: 'Dos', avatarUrl: null } },
      { postId: 'a', userId: 'u3', user: { displayName: 'Tres', avatarUrl: null } },
      { postId: 'a', userId: 'u4', user: { displayName: 'Cuatro', avatarUrl: null } },
      { postId: 'a', userId: 'u5', user: { displayName: 'Cinco', avatarUrl: null } },
      { postId: 'a', userId: 'u6', user: { displayName: 'Seis', avatarUrl: null } },
    ])

    const { items } = await listPostsByPlace({ placeId: 'place-1' })

    expect(items[0]?.readerSample).toHaveLength(4)
    expect(items[0]?.readerSample.map((r) => r.userId)).toEqual(['u1', 'u2', 'u3', 'u4'])
  })

  it('readerSample query filtra ex-miembros (memberships con leftAt=null)', async () => {
    findOrCreateOpeningMock.mockResolvedValue({ id: 'opening-1' })
    postFindMany.mockResolvedValue([row('a', new Date('2026-04-19T10:00:00Z'))])
    postReadFindMany.mockResolvedValue([])

    await listPostsByPlace({ placeId: 'place-1' })

    expect(postReadFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          placeOpeningId: 'opening-1',
          postId: { in: ['a'] },
          user: {
            memberships: { some: { placeId: 'place-1', leftAt: null } },
          },
        }),
      }),
    )
  })

  it('isFeatured=true solo para el primer post de la primera página (sin cursor)', async () => {
    postFindMany.mockResolvedValue([
      row('a', new Date('2026-04-19T10:00:00Z')),
      row('b', new Date('2026-04-19T09:00:00Z')),
      row('c', new Date('2026-04-19T08:00:00Z')),
    ])

    const { items } = await listPostsByPlace({ placeId: 'place-1' })

    expect(items[0]?.isFeatured).toBe(true)
    expect(items[1]?.isFeatured).toBe(false)
    expect(items[2]?.isFeatured).toBe(false)
  })

  it('isFeatured=false para todos cuando hay cursor (página subsiguiente)', async () => {
    postFindMany.mockResolvedValue([
      row('a', new Date('2026-04-19T10:00:00Z')),
      row('b', new Date('2026-04-19T09:00:00Z')),
    ])

    const { items } = await listPostsByPlace({
      placeId: 'place-1',
      cursor: { createdAt: new Date('2026-04-19T11:00:00Z'), id: 'prev' },
    })

    expect(items[0]?.isFeatured).toBe(false)
    expect(items[1]?.isFeatured).toBe(false)
  })
})
