import 'server-only'
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/db/client'
import type {
  Tier,
  TierCurrency,
  TierDuration,
  TierVisibility,
} from '@/features/tiers/domain/types'
import { tiersByPlaceTag } from './cache'

/**
 * Queries del slice `tiers` (T.2).
 *
 * Solo este archivo + sus hermanos en `server/actions/*` tocan Prisma.
 * El resto del slice (UI, domain) consume vía `public.ts` /
 * `public.server.ts`.
 *
 * **Visibility gate explícito**: todas las funciones reciben
 * `viewerIsOwner: boolean` sin default. Sin parámetro = no compila —
 * fail-loud, no hay default permisivo. Si `!viewerIsOwner`, las
 * queries filtran a `visibility = PUBLISHED` (en `findTierById`
 * retornan `null` si el tier es `HIDDEN` para evitar enumeración).
 *
 * RLS no está activa todavía (deferida al plan unificado de RLS,
 * ver `docs/decisions/2026-05-01-rls-comprehensive-pre-launch.md`).
 * Hasta que llegue, el filtrado vive en el WHERE de cada query.
 *
 * Ver `docs/features/tiers/spec.md` § 7.
 */

type TierRow = {
  id: string
  placeId: string
  name: string
  description: string | null
  priceCents: number
  currency: string
  duration: TierDuration
  visibility: TierVisibility
  createdAt: Date
  updatedAt: Date
}

function mapTierRow(row: TierRow): Tier {
  return {
    id: row.id,
    placeId: row.placeId,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    // El cast es seguro porque Zod (en actions) y los enums Postgres limitan
    // los valores posibles. Si llegara un valor fuera de la allowlist, sería
    // un bug de la migration o de un INSERT manual — caso no recuperable.
    currency: row.currency as TierCurrency,
    duration: row.duration,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Lista los tiers de un place.
 *
 * - `viewerIsOwner = true` ⇒ todos los tiers (PUBLISHED + HIDDEN).
 *   Caso típico: page `/settings/tiers` del owner.
 * - `viewerIsOwner = false` ⇒ solo `visibility = PUBLISHED`. Caso:
 *   pricing pages futuros (members o anónimos).
 *
 * Ordenado por `createdAt DESC` — los nuevos arriba. Index
 * `(placeId, createdAt)` cubre el sort.
 */
async function listTiersByPlaceRaw(placeId: string, viewerIsOwner: boolean): Promise<Tier[]> {
  const rows = await prisma.tier.findMany({
    where: {
      placeId,
      ...(viewerIsOwner ? {} : { visibility: 'PUBLISHED' as const }),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      placeId: true,
      name: true,
      description: true,
      priceCents: true,
      currency: true,
      duration: true,
      visibility: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  return rows.map(mapTierRow)
}

/**
 * Cache cross-request via `unstable_cache`. Key: `(placeId, viewerIsOwner)`
 * — el shape cambia por viewer (todos vs sólo PUBLISHED), así que es parte
 * de la key. Tag `tiers:${placeId}` invalidado desde actions que muten
 * `Tier`. `revalidate: 60` es floor de safety si el tag se pierde (ej:
 * deploy reset). `React.cache` envuelve por encima para deduplicar dentro
 * del render tree.
 */
export const listTiersByPlace = cache(
  async (placeId: string, viewerIsOwner: boolean): Promise<Tier[]> => {
    return unstable_cache(
      () => listTiersByPlaceRaw(placeId, viewerIsOwner),
      ['tiers-by-place', placeId, String(viewerIsOwner)],
      {
        tags: [tiersByPlaceTag(placeId)],
        revalidate: 60,
      },
    )()
  },
)

/**
 * Resuelve un tier por id.
 *
 * - `viewerIsOwner = true` ⇒ devuelve el tier (PUBLISHED o HIDDEN).
 * - `viewerIsOwner = false` ⇒ devuelve `null` si el tier es HIDDEN
 *   (mismo shape que "no existe" — evita enumeración por id).
 */
export async function findTierById(tierId: string, viewerIsOwner: boolean): Promise<Tier | null> {
  const row = await prisma.tier.findUnique({
    where: { id: tierId },
    select: {
      id: true,
      placeId: true,
      name: true,
      description: true,
      priceCents: true,
      currency: true,
      duration: true,
      visibility: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (!row) return null
  if (!viewerIsOwner && row.visibility !== 'PUBLISHED') return null
  return mapTierRow(row)
}
