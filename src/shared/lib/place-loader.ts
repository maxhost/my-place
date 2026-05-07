import 'server-only'
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
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

/**
 * Tag builders del cache cross-request. Definidos acá (donde el cache vive)
 * para no violar la regla "shared no importa de features"; el slice `places`
 * los re-exporta via `features/places/public.server.ts` junto con sus helpers
 * de invalidación. Mutations llaman `revalidatePlaceCache(slug, id)` desde
 * `places/server/cache.ts`.
 */
export function placeBySlugTag(slug: string): string {
  return `place:slug:${slug}`
}

export function placeByIdTag(id: string): string {
  return `place:id:${id}`
}

const PLACE_CACHE_REVALIDATE_SECONDS = 60

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

/**
 * Capa cross-request: `unstable_cache` con tag granular + `revalidate: 60`
 * (safety net si el invalidate se pierde, ej: deploy reset). Las mutations
 * sobre Place llaman `revalidatePlaceCache(slug, id)` desde
 * `features/places/server/cache.ts` para forzar refresh inmediato.
 *
 * `getPlaceCache()` (capa per-request) se mantiene encima de esta capa:
 * dentro del mismo render, el unified map sigue dedupeando lookups por
 * slug ↔ id; entre requests, `unstable_cache` ahorra el round-trip al
 * pooler para el mismo place.
 */
function findBySlugRaw(slug: string) {
  return unstable_cache(
    () =>
      prisma.place.findUnique({
        where: { slug },
        select: PLACE_SELECT,
      }),
    ['place-by-slug', slug],
    { tags: [placeBySlugTag(slug)], revalidate: PLACE_CACHE_REVALIDATE_SECONDS },
  )()
}

function findByIdRaw(id: string) {
  return unstable_cache(
    () =>
      prisma.place.findUnique({
        where: { id },
        select: PLACE_SELECT,
      }),
    ['place-by-id', id],
    { tags: [placeByIdTag(id)], revalidate: PLACE_CACHE_REVALIDATE_SECONDS },
  )()
}
