import 'server-only'
import { cache } from 'react'
import { prisma } from '@/db/client'
import { OutOfHoursError } from '@/shared/errors/domain-error'
import { isPlaceOpen } from '../domain/invariants'
import { parseOpeningHours } from '../schemas'
import type { OpeningHours } from '../domain/types'

/**
 * Queries del slice `hours`. Solo este archivo + `actions.ts` tocan Prisma.
 * El resto del slice consume vía `public.ts`.
 */

/**
 * Lee `Place.openingHours` y lo pasa por `parseOpeningHours` (fallback defensivo).
 * Wrappeado en `React.cache` para que layout + página dentro de la misma request
 * no hagan dos queries — la próxima request invalida el cache.
 */
export const findPlaceHours = cache(async (placeId: string): Promise<OpeningHours> => {
  const place = await prisma.place.findUnique({
    where: { id: placeId },
    select: { openingHours: true },
  })
  if (!place) return { kind: 'unconfigured' }
  return parseOpeningHours(place.openingHours)
})

/**
 * Helper para que server actions de Fase 5 (conversaciones) y Fase 6 (eventos)
 * defiendan sus escrituras: si el place está cerrado, lanza `OutOfHoursError`.
 *
 * Defensa en profundidad — el gate de UI (`(gated)/layout.tsx`) ya evita que se
 * renderice el composer, pero este assert protege contra llamadas directas.
 */
export async function assertPlaceOpenOrThrow(
  placeId: string,
  now: Date = new Date(),
): Promise<void> {
  const hours = await findPlaceHours(placeId)
  const status = isPlaceOpen(hours, now)
  if (!status.open) {
    throw new OutOfHoursError('El place está cerrado en este momento.', placeId, status.opensAt)
  }
}

/**
 * Lookup de place por slug — mínimo para el action de `updatePlaceHoursAction`.
 * Mantiene al slice `hours` autónomo (no cruza a `members/places` para una query
 * de dos columnas). Ver `docs/architecture.md` § boundaries.
 */
export async function findPlaceStateBySlug(
  slug: string,
): Promise<{ id: string; slug: string; archivedAt: Date | null } | null> {
  return prisma.place.findUnique({
    where: { slug },
    select: { id: true, slug: true, archivedAt: true },
  })
}
