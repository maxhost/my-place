import 'server-only'
import { prisma } from '@/db/client'
import type { AssignedBySnapshot, TierMembershipDetail } from '@/features/tier-memberships/public'
import type { GroupSummary } from '@/features/groups/public'
import type { TierCurrency } from '@/features/tiers/public'
import type { MemberDetailBlockInfo } from '../ui/member-detail-panel'

/**
 * Queries batch para alimentar el `<MembersAdminPanel>` con datos del detail
 * y los sub-sheets en una sola page-render.
 *
 * Diseño: en vez de N queries por miembro visible (1 por tier-memberships + 1
 * por groups + 1 por block-info), agrupamos a nivel de place con SELECT
 * filtrado a los userIds que estamos mostrando. Sobre el pooler
 * `connection_limit=1` esto es 3 round-trips fijos en lugar de N×3.
 *
 * Spec: docs/plans/2026-05-14-redesign-settings-members.md § Sesión 3.5.
 */

/**
 * Map userId → TierMembershipDetail[] del place. Filtrado a los userIds
 * provistos. Devuelve `[]` para userIds sin asignaciones.
 */
export async function listTierMembershipsForUsers(
  placeId: string,
  userIds: ReadonlyArray<string>,
): Promise<Map<string, TierMembershipDetail[]>> {
  if (userIds.length === 0) return new Map()
  const rows = await prisma.tierMembership.findMany({
    where: { placeId, userId: { in: [...userIds] } },
    orderBy: { assignedAt: 'desc' },
    select: {
      id: true,
      placeId: true,
      userId: true,
      tierId: true,
      assignedByUserId: true,
      assignedBySnapshot: true,
      assignedAt: true,
      expiresAt: true,
      updatedAt: true,
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
    },
  })
  const byUserId = new Map<string, TierMembershipDetail[]>()
  for (const r of rows) {
    const detail: TierMembershipDetail = {
      id: r.id,
      placeId: r.placeId,
      userId: r.userId,
      tierId: r.tierId,
      assignedByUserId: r.assignedByUserId,
      assignedBySnapshot: r.assignedBySnapshot as AssignedBySnapshot,
      assignedAt: r.assignedAt,
      expiresAt: r.expiresAt,
      updatedAt: r.updatedAt,
      tier: {
        id: r.tier.id,
        placeId: r.tier.placeId,
        name: r.tier.name,
        description: r.tier.description,
        priceCents: r.tier.priceCents,
        currency: r.tier.currency as TierCurrency,
        duration: r.tier.duration,
        visibility: r.tier.visibility,
        createdAt: r.tier.createdAt,
        updatedAt: r.tier.updatedAt,
      },
    }
    const list = byUserId.get(r.userId)
    if (list) list.push(detail)
    else byUserId.set(r.userId, [detail])
  }
  return byUserId
}

/**
 * Map userId → GroupSummary[]. Lista los grupos a los que pertenece cada
 * miembro provisto. Útil para el sub-sheet "Gestionar grupos" y para
 * derivar `availableGroups` (allGroups − currentGroups).
 */
export async function listGroupsForUsers(
  placeId: string,
  userIds: ReadonlyArray<string>,
): Promise<Map<string, GroupSummary[]>> {
  if (userIds.length === 0) return new Map()
  const rows = await prisma.groupMembership.findMany({
    where: { placeId, userId: { in: [...userIds] } },
    orderBy: { addedAt: 'asc' },
    select: {
      userId: true,
      group: { select: { id: true, name: true, isPreset: true } },
    },
  })
  const byUserId = new Map<string, GroupSummary[]>()
  for (const r of rows) {
    const summary: GroupSummary = {
      id: r.group.id,
      name: r.group.name,
      isPreset: r.group.isPreset,
    }
    const list = byUserId.get(r.userId)
    if (list) list.push(summary)
    else byUserId.set(r.userId, [summary])
  }
  return byUserId
}

/**
 * Map userId → MemberDetailBlockInfo. Solo entradas para miembros que están
 * bloqueados (`blockedAt IS NOT NULL` AND `leftAt IS NULL`). Userids sin
 * bloqueo NO aparecen en el map.
 */
export async function listBlockInfoForUsers(
  placeId: string,
  userIds: ReadonlyArray<string>,
): Promise<Map<string, MemberDetailBlockInfo>> {
  if (userIds.length === 0) return new Map()
  const rows = await prisma.membership.findMany({
    where: {
      placeId,
      userId: { in: [...userIds] },
      leftAt: null,
      NOT: { blockedAt: null },
    },
    select: {
      userId: true,
      blockedAt: true,
      blockedReason: true,
      blockedContactEmail: true,
      blockedBy: { select: { displayName: true } },
    },
  })
  const byUserId = new Map<string, MemberDetailBlockInfo>()
  for (const r of rows) {
    if (r.blockedAt === null) continue
    byUserId.set(r.userId, {
      blockedAt: r.blockedAt,
      blockedReason: r.blockedReason,
      blockedContactEmail: r.blockedContactEmail,
      blockedByDisplayName: r.blockedBy?.displayName ?? null,
    })
  }
  return byUserId
}
