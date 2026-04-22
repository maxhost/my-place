import { describe, expect, it, vi, beforeEach } from 'vitest'

const groupByFn = vi.fn()
const findManyFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    reaction: {
      groupBy: (...a: unknown[]) => groupByFn(...a),
      findMany: (...a: unknown[]) => findManyFn(...a),
    },
  },
}))

vi.mock('server-only', () => ({}))

import { aggregateReactions, reactionMapKey } from '../server/reactions-aggregation'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('aggregateReactions', () => {
  it('devuelve Map vacío si no hay targets', async () => {
    const result = await aggregateReactions({
      targets: [],
      viewerUserId: 'u-1',
    })
    expect(result.size).toBe(0)
    expect(groupByFn).not.toHaveBeenCalled()
    expect(findManyFn).not.toHaveBeenCalled()
  })

  it('agrupa counts por target+emoji y marca viewerReacted correctamente', async () => {
    groupByFn.mockResolvedValue([
      {
        targetType: 'POST',
        targetId: 'po-1',
        emoji: 'THUMBS_UP',
        _count: { _all: 3 },
      },
      {
        targetType: 'POST',
        targetId: 'po-1',
        emoji: 'HEART',
        _count: { _all: 1 },
      },
      {
        targetType: 'COMMENT',
        targetId: 'c-1',
        emoji: 'LAUGH',
        _count: { _all: 2 },
      },
    ])
    findManyFn.mockResolvedValue([{ targetType: 'POST', targetId: 'po-1', emoji: 'THUMBS_UP' }])

    const result = await aggregateReactions({
      targets: [
        { type: 'POST', id: 'po-1' },
        { type: 'COMMENT', id: 'c-1' },
      ],
      viewerUserId: 'u-1',
    })

    const post = result.get(reactionMapKey('POST', 'po-1'))
    expect(post).toHaveLength(2)
    const thumbs = post?.find((r) => r.emoji === 'THUMBS_UP')
    const heart = post?.find((r) => r.emoji === 'HEART')
    expect(thumbs).toEqual({ emoji: 'THUMBS_UP', count: 3, viewerReacted: true })
    expect(heart).toEqual({ emoji: 'HEART', count: 1, viewerReacted: false })

    const comment = result.get(reactionMapKey('COMMENT', 'c-1'))
    expect(comment).toEqual([{ emoji: 'LAUGH', count: 2, viewerReacted: false }])
  })

  it('viewer sin reacciones: todo viewerReacted:false', async () => {
    groupByFn.mockResolvedValue([
      {
        targetType: 'POST',
        targetId: 'po-1',
        emoji: 'PRAY',
        _count: { _all: 5 },
      },
    ])
    findManyFn.mockResolvedValue([])

    const result = await aggregateReactions({
      targets: [{ type: 'POST', id: 'po-1' }],
      viewerUserId: 'u-1',
    })
    const entry = result.get(reactionMapKey('POST', 'po-1'))
    expect(entry).toEqual([{ emoji: 'PRAY', count: 5, viewerReacted: false }])
  })

  it('target sin ninguna reacción no aparece en el Map', async () => {
    groupByFn.mockResolvedValue([])
    findManyFn.mockResolvedValue([])

    const result = await aggregateReactions({
      targets: [{ type: 'POST', id: 'po-vacio' }],
      viewerUserId: 'u-1',
    })
    expect(result.size).toBe(0)
  })

  it('corre groupBy + findMany en paralelo con el mismo OR clause', async () => {
    groupByFn.mockResolvedValue([])
    findManyFn.mockResolvedValue([])

    await aggregateReactions({
      targets: [
        { type: 'POST', id: 'po-1' },
        { type: 'COMMENT', id: 'c-1' },
      ],
      viewerUserId: 'u-1',
    })

    const groupByCall = groupByFn.mock.calls[0]?.[0]
    expect(groupByCall?.where.OR).toEqual([
      { targetType: 'POST', targetId: 'po-1' },
      { targetType: 'COMMENT', targetId: 'c-1' },
    ])
    const findManyCall = findManyFn.mock.calls[0]?.[0]
    expect(findManyCall?.where.OR).toEqual(groupByCall?.where.OR)
    expect(findManyCall?.where.userId).toBe('u-1')
  })
})
