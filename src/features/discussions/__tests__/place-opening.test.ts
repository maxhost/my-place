import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

const placeOpeningFindFirst = vi.fn()
const placeOpeningCreate = vi.fn()
const placeOpeningUpdateMany = vi.fn()
const findPlaceHoursFn = vi.fn()
const currentOpeningWindowFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    placeOpening: {
      findFirst: (...a: unknown[]) => placeOpeningFindFirst(...a),
      create: (...a: unknown[]) => placeOpeningCreate(...a),
      updateMany: (...a: unknown[]) => placeOpeningUpdateMany(...a),
    },
  },
}))

vi.mock('@/features/hours/public', () => ({
  findPlaceHours: (...a: unknown[]) => findPlaceHoursFn(...a),
  currentOpeningWindow: (...a: unknown[]) => currentOpeningWindowFn(...a),
}))

vi.mock('server-only', () => ({}))

import { findOrCreateCurrentOpening } from '../server/place-opening'

beforeEach(() => {
  placeOpeningFindFirst.mockReset()
  placeOpeningCreate.mockReset()
  placeOpeningUpdateMany.mockReset()
  findPlaceHoursFn.mockReset()
  currentOpeningWindowFn.mockReset()
})

describe('findOrCreateCurrentOpening', () => {
  it('unconfigured => null, no writes', async () => {
    findPlaceHoursFn.mockResolvedValue({ kind: 'unconfigured' })
    const result = await findOrCreateCurrentOpening('p-1', new Date())
    expect(result).toBeNull()
    expect(placeOpeningCreate).not.toHaveBeenCalled()
  })

  it('always_open sin apertura activa => crea apertura con source=ALWAYS_OPEN', async () => {
    findPlaceHoursFn.mockResolvedValue({ kind: 'always_open' })
    placeOpeningFindFirst.mockResolvedValue(null)
    placeOpeningCreate.mockResolvedValue({ id: 'op-1', startAt: new Date('2026-04-20') })

    const result = await findOrCreateCurrentOpening('p-1', new Date('2026-04-20T10:00:00Z'))
    expect(result?.id).toBe('op-1')
    expect(placeOpeningCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'ALWAYS_OPEN', placeId: 'p-1' }),
      }),
    )
  })

  it('always_open con apertura activa => reusa', async () => {
    findPlaceHoursFn.mockResolvedValue({ kind: 'always_open' })
    const existing = { id: 'op-1', startAt: new Date('2026-01-01') }
    placeOpeningFindFirst.mockResolvedValue(existing)

    const result = await findOrCreateCurrentOpening('p-1', new Date())
    expect(result).toEqual({ ...existing, endAt: null })
    expect(placeOpeningCreate).not.toHaveBeenCalled()
  })

  it('scheduled fuera de ventana con apertura activa => cierra la apertura', async () => {
    findPlaceHoursFn.mockResolvedValue({ kind: 'scheduled' })
    currentOpeningWindowFn.mockReturnValue(null)
    placeOpeningFindFirst.mockResolvedValue({
      id: 'op-1',
      startAt: new Date('2026-04-20T08:00:00Z'),
      endAt: null,
    })
    placeOpeningUpdateMany.mockResolvedValue({ count: 1 })

    const result = await findOrCreateCurrentOpening('p-1', new Date('2026-04-20T22:00:00Z'))
    expect(result).toBeNull()
    expect(placeOpeningUpdateMany).toHaveBeenCalledWith({
      where: { id: 'op-1', endAt: null },
      data: { endAt: expect.any(Date) },
    })
  })

  it('scheduled dentro de ventana sin apertura activa => abre', async () => {
    const window = {
      start: new Date('2026-04-20T08:00:00Z'),
      end: new Date('2026-04-20T20:00:00Z'),
    }
    findPlaceHoursFn.mockResolvedValue({ kind: 'scheduled' })
    currentOpeningWindowFn.mockReturnValue(window)
    placeOpeningFindFirst.mockResolvedValue(null)
    placeOpeningCreate.mockResolvedValue({ id: 'op-new', startAt: window.start })

    const result = await findOrCreateCurrentOpening('p-1', new Date('2026-04-20T10:00:00Z'))
    expect(result?.id).toBe('op-new')
    expect(placeOpeningCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'SCHEDULED', startAt: window.start }),
      }),
    )
  })

  it('scheduled dentro de ventana con apertura activa => reusa', async () => {
    findPlaceHoursFn.mockResolvedValue({ kind: 'scheduled' })
    currentOpeningWindowFn.mockReturnValue({
      start: new Date(),
      end: new Date(Date.now() + 3600_000),
    })
    const existing = { id: 'op-1', startAt: new Date(), endAt: null }
    placeOpeningFindFirst.mockResolvedValue(existing)

    const result = await findOrCreateCurrentOpening('p-1', new Date())
    expect(result).toEqual(existing)
    expect(placeOpeningCreate).not.toHaveBeenCalled()
  })

  it('race condition: P2002 al crear => relee la apertura activa', async () => {
    findPlaceHoursFn.mockResolvedValue({ kind: 'scheduled' })
    currentOpeningWindowFn.mockReturnValue({
      start: new Date('2026-04-20T08:00:00Z'),
      end: new Date('2026-04-20T20:00:00Z'),
    })
    placeOpeningFindFirst
      .mockResolvedValueOnce(null) // primer lookup antes del create
      .mockResolvedValueOnce({
        id: 'op-race',
        startAt: new Date('2026-04-20T08:00:00Z'),
      })

    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: '5',
    })
    placeOpeningCreate.mockRejectedValue(p2002)

    const result = await findOrCreateCurrentOpening('p-1', new Date('2026-04-20T10:00:00Z'))
    expect(result?.id).toBe('op-race')
  })
})
