import { beforeEach, describe, expect, it, vi } from 'vitest'

const placeFindUnique = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    place: {
      findUnique: (...args: unknown[]) => placeFindUnique(...args),
    },
  },
}))

import { createPlaceCache, loadPlaceByIdWithCache, loadPlaceBySlugWithCache } from '../place-loader'

const PLACE = {
  id: 'p-1',
  slug: 'palermo',
  name: 'Palermo',
  archivedAt: null,
  themeConfig: {},
  openingHours: null,
}

beforeEach(() => {
  placeFindUnique.mockReset()
})

describe('unified place cache', () => {
  it('loadPlaceBySlug cachea por slug en el mismo request', async () => {
    placeFindUnique.mockResolvedValue(PLACE)
    const cache = createPlaceCache()

    const a = await loadPlaceBySlugWithCache(cache, 'palermo')
    const b = await loadPlaceBySlugWithCache(cache, 'palermo')

    expect(a).toBe(PLACE)
    expect(b).toBe(PLACE)
    expect(placeFindUnique).toHaveBeenCalledTimes(1)
  })

  it('loadPlaceById cachea por id en el mismo request', async () => {
    placeFindUnique.mockResolvedValue(PLACE)
    const cache = createPlaceCache()

    await loadPlaceByIdWithCache(cache, 'p-1')
    await loadPlaceByIdWithCache(cache, 'p-1')

    expect(placeFindUnique).toHaveBeenCalledTimes(1)
  })

  it('slug → id: un lookup por id después de uno por slug no dispara query', async () => {
    placeFindUnique.mockResolvedValue(PLACE)
    const cache = createPlaceCache()

    const bySlug = await loadPlaceBySlugWithCache(cache, 'palermo')
    const byId = await loadPlaceByIdWithCache(cache, 'p-1')

    expect(bySlug).toBe(PLACE)
    expect(byId).toBe(PLACE)
    expect(placeFindUnique).toHaveBeenCalledTimes(1)
  })

  it('id → slug: un lookup por slug después de uno por id no dispara query', async () => {
    placeFindUnique.mockResolvedValue(PLACE)
    const cache = createPlaceCache()

    await loadPlaceByIdWithCache(cache, 'p-1')
    await loadPlaceBySlugWithCache(cache, 'palermo')

    expect(placeFindUnique).toHaveBeenCalledTimes(1)
  })

  it('null no pollute el cache cruzado', async () => {
    placeFindUnique.mockResolvedValue(null)
    const cache = createPlaceCache()

    const result = await loadPlaceBySlugWithCache(cache, 'ghost')
    expect(result).toBeNull()
    // bySlug sí almacena el promise null para dedupe repetido
    expect(cache.bySlug.get('ghost')).toBeDefined()
    // byId NO se sembró (no sabemos el id de un place inexistente)
    expect(cache.byId.size).toBe(0)
  })

  it('cachea también las rejections (behavior-equivalent con React.cache)', async () => {
    const err = new Error('db down')
    placeFindUnique.mockRejectedValue(err)
    const cache = createPlaceCache()

    await expect(loadPlaceBySlugWithCache(cache, 'palermo')).rejects.toBe(err)
    await expect(loadPlaceBySlugWithCache(cache, 'palermo')).rejects.toBe(err)

    expect(placeFindUnique).toHaveBeenCalledTimes(1)
  })

  it('llamadas concurrentes con el mismo slug comparten la query in-flight', async () => {
    let resolveQuery: (v: typeof PLACE) => void = () => {}
    placeFindUnique.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve
        }),
    )
    const cache = createPlaceCache()

    const p1 = loadPlaceBySlugWithCache(cache, 'palermo')
    const p2 = loadPlaceBySlugWithCache(cache, 'palermo')

    expect(placeFindUnique).toHaveBeenCalledTimes(1)
    resolveQuery(PLACE)

    expect(await p1).toBe(PLACE)
    expect(await p2).toBe(PLACE)
  })
})
