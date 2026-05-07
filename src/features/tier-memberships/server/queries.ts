import 'server-only'
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/db/client'
import type { TierCurrency, TierDuration, TierVisibility } from '@/features/tiers/public'
import type {
  AssignedBySnapshot,
  TierMembership,
  TierMembershipDetail,
} from '@/features/tier-memberships/domain/types'
import { tierAssignmentsTag } from './cache'

/**
 * Queries del slice `tier-memberships` (M.2).
 *
 * Solo este archivo + sus hermanos en `server/actions/*` tocan Prisma.
 * El resto del slice (UI, domain) consume vía `public.ts` /
 * `public.server.ts`.
 *
 * v1 NO distingue activo vs expirado — `expiresAt` se persiste informativo
 * pero ninguna query filtra por él. Cuando llegue Stripe (Fase 3), el cron
 * de expiración + paywall sí filtran por `expiresAt > NOW() OR expiresAt IS NULL`.
 *
 * RLS no está activa todavía (deferida al plan unificado de RLS,
 * `docs/decisions/2026-05-01-rls-comprehensive-pre-launch.md`). El gate
 * de owner-only vive en cada server action.
 *
 * Ver `docs/features/tier-memberships/spec.md` § 3.
 */

type TierMembershipRow = {
  id: string
  tierId: string
  userId: string
  placeId: string
  assignedAt: Date
  assignedByUserId: string | null
  assignedBySnapshot: unknown
  expiresAt: Date | null
  updatedAt: Date
}

type TierMembershipRowWithTier = TierMembershipRow & {
  tier: {
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
}

/**
 * Coerciona el JSON del snapshot al shape `AssignedBySnapshot`. Defensa
 * contra rows legacy o corrupted: si falla, devuelve un placeholder
 * "ex-asignador" antes que crashear el render.
 */
function coerceSnapshot(json: unknown): AssignedBySnapshot {
  if (json && typeof json === 'object') {
    const obj = json as { displayName?: unknown; avatarUrl?: unknown }
    if (typeof obj.displayName === 'string') {
      return {
        displayName: obj.displayName,
        avatarUrl: typeof obj.avatarUrl === 'string' ? obj.avatarUrl : null,
      }
    }
  }
  return { displayName: 'ex-asignador', avatarUrl: null }
}

function mapTierMembershipRow(row: TierMembershipRow): TierMembership {
  return {
    id: row.id,
    tierId: row.tierId,
    userId: row.userId,
    placeId: row.placeId,
    assignedAt: row.assignedAt,
    assignedByUserId: row.assignedByUserId,
    assignedBySnapshot: coerceSnapshot(row.assignedBySnapshot),
    expiresAt: row.expiresAt,
    updatedAt: row.updatedAt,
  }
}

function mapTierMembershipRowWithTier(row: TierMembershipRowWithTier): TierMembershipDetail {
  return {
    ...mapTierMembershipRow(row),
    tier: {
      id: row.tier.id,
      placeId: row.tier.placeId,
      name: row.tier.name,
      description: row.tier.description,
      priceCents: row.tier.priceCents,
      // Mismo cast seguro que en tiers/queries: Zod + enum Postgres limitan
      // los valores posibles. Si llegara algo fuera de la allowlist sería
      // un bug de migration o de un INSERT manual — caso no recuperable.
      currency: row.tier.currency as TierCurrency,
      duration: row.tier.duration,
      visibility: row.tier.visibility,
      createdAt: row.tier.createdAt,
      updatedAt: row.tier.updatedAt,
    },
  }
}

const TIER_MEMBERSHIP_SELECT = {
  id: true,
  tierId: true,
  userId: true,
  placeId: true,
  assignedAt: true,
  assignedByUserId: true,
  assignedBySnapshot: true,
  expiresAt: true,
  updatedAt: true,
} as const

const TIER_INCLUDE = {
  tier: {
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
  },
} as const

/**
 * Lista todas las asignaciones de un place. v1 no se usa en UI — queda
 * para audit/debug futuro y para tests de integridad.
 *
 * Ordenado por `assignedAt DESC` (las más recientes primero).
 */
export async function listAssignmentsByPlace(placeId: string): Promise<TierMembership[]> {
  const rows = await prisma.tierMembership.findMany({
    where: { placeId },
    orderBy: { assignedAt: 'desc' },
    select: TIER_MEMBERSHIP_SELECT,
  })
  return rows.map(mapTierMembershipRow)
}

/**
 * Helper interno sin caching externo — el wrapper `unstable_cache` lo envuelve
 * por (userId, placeId).
 */
async function listAssignmentsByMemberRaw(
  userId: string,
  placeId: string,
): Promise<TierMembershipDetail[]> {
  const rows = await prisma.tierMembership.findMany({
    where: { userId, placeId },
    orderBy: { assignedAt: 'desc' },
    select: { ...TIER_MEMBERSHIP_SELECT, ...TIER_INCLUDE },
  })
  return rows.map((row) => mapTierMembershipRowWithTier(row as TierMembershipRowWithTier))
}

/**
 * Lista las asignaciones de un miembro en un place — incluye el `Tier`
 * joined en una sola query (`include`). NO N+1.
 *
 * Alimenta el detalle del miembro (`/settings/members/[userId]`).
 *
 * Ordenado por `assignedAt DESC` — la asignación más reciente arriba.
 *
 * Cache cross-request via `unstable_cache`. Key: `(userId, placeId)`. Tag
 * `tier-assignments:${placeId}:${userId}` invalidado desde
 * `assignTierToMemberAction` / `removeTierAssignmentAction`.
 * `revalidate: 60` es floor de safety si el tag se pierde (ej: deploy reset).
 * `React.cache` envuelve por encima para deduplicar dentro del render tree.
 */
export const listAssignmentsByMember = cache(
  async (userId: string, placeId: string): Promise<TierMembershipDetail[]> => {
    return unstable_cache(
      () => listAssignmentsByMemberRaw(userId, placeId),
      ['tier-assignments', userId, placeId],
      {
        tags: [tierAssignmentsTag(placeId, userId)],
        revalidate: 60,
      },
    )()
  },
)

/**
 * Alias semántico de `listAssignmentsByMember`. v1 NO distingue activo vs
 * expirado — todas las asignaciones cuentan como "activas" para fines de
 * gate de UI.
 *
 * Cuando llegue Stripe (Fase 3), esta query filtrará por
 * `expiresAt > NOW() OR expiresAt IS NULL` y `listAssignmentsByMember`
 * seguirá retornando todas (incluso vencidas, para audit).
 */
export async function findActiveAssignmentsForMember(
  userId: string,
  placeId: string,
): Promise<TierMembershipDetail[]> {
  return listAssignmentsByMember(userId, placeId)
}
