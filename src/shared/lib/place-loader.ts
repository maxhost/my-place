import 'server-only'
import { cache } from 'react'
import { prisma } from '@/db/client'

/**
 * Request-scoped cache unificado de `Place`. Layout padre típico hace lookup por
 * `slug`; layouts/actions descendientes llegan con `placeId` y pedirían un
 * segundo query redundante si `loadPlaceBySlug` y `loadPlaceById` tuvieran memos
 * independientes de `React.cache`.
 *
 * El map interno resuelve ambos nombres a la misma fila: cuando un lookup por
 * slug termina, sembrá el slot `byId` con el mismo promise; idem al revés. Dos
 * callers del mismo Place desde cualquier ángulo → 1 query total por request.
 *
 * Ver `docs/decisions/2026-04-21-unified-place-cache.md`.
 */

/**
 * `openingHours` viaja en el shape base porque el gate de horario (`(gated)/layout.tsx`)
 * lo consume en cada request. Incluirlo acá evita un segundo `place.findUnique` en
 * `findPlaceHours(placeId)` cuando el caller ya tiene el Place cargado; los callers
 * que solo tienen `placeId` (ej: server actions) siguen usando `findPlaceHours`
 * que ahora delega a `loadPlaceById` y reusa este cache.
 */
const PLACE_SELECT = {
  id: true,
  slug: true,
  name: true,
  archivedAt: true,
  themeConfig: true,
  openingHours: true,
} as const

export type LoadedPlace = NonNullable<Awaited<ReturnType<typeof findByIdRaw>>>

type PlacePromise = Promise<LoadedPlace | null>

export type PlaceCache = {
  bySlug: Map<string, PlacePromise>
  byId: Map<string, PlacePromise>
}

/**
 * Factory interna. Exportada para tests unit que no pueden usar `React.cache`
 * fuera de un render context. En producción, `getPlaceCache()` la wrapea.
 */
export function createPlaceCache(): PlaceCache {
  return { bySlug: new Map(), byId: new Map() }
}

const getPlaceCache = cache((): PlaceCache => createPlaceCache())

/**
 * Helper interno testeable sin React. La variante pública `loadPlaceBySlug`
 * delega acá pasándole el cache resuelto por `getPlaceCache()`.
 */
export async function loadPlaceBySlugWithCache(
  cacheInstance: PlaceCache,
  slug: string,
): Promise<LoadedPlace | null> {
  const cached = cacheInstance.bySlug.get(slug)
  if (cached) return cached

  const pending: PlacePromise = (async () => {
    const row = await findBySlugRaw(slug)
    if (row) {
      // Sembramos el slot `byId` con el mismo resultado para que un lookup por
      // id posterior no dispare un segundo query. `Promise.resolve(row)` evita
      // reasignar el promise original, que queda dedicado al slot `bySlug`.
      cacheInstance.byId.set(row.id, Promise.resolve(row))
    }
    return row
  })()

  cacheInstance.bySlug.set(slug, pending)
  return pending
}

export async function loadPlaceByIdWithCache(
  cacheInstance: PlaceCache,
  id: string,
): Promise<LoadedPlace | null> {
  const cached = cacheInstance.byId.get(id)
  if (cached) return cached

  const pending: PlacePromise = (async () => {
    const row = await findByIdRaw(id)
    if (row) {
      cacheInstance.bySlug.set(row.slug, Promise.resolve(row))
    }
    return row
  })()

  cacheInstance.byId.set(id, pending)
  return pending
}

export async function loadPlaceBySlug(slug: string): Promise<LoadedPlace | null> {
  return loadPlaceBySlugWithCache(getPlaceCache(), slug)
}

export async function loadPlaceById(id: string): Promise<LoadedPlace | null> {
  return loadPlaceByIdWithCache(getPlaceCache(), id)
}

function findBySlugRaw(slug: string) {
  return prisma.place.findUnique({
    where: { slug },
    select: PLACE_SELECT,
  })
}

function findByIdRaw(id: string) {
  return prisma.place.findUnique({
    where: { id },
    select: PLACE_SELECT,
  })
}
