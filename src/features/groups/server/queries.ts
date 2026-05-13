import 'server-only'
import { cache } from 'react'
import { prisma } from '@/db/client'
import { isValidPermission, type Permission } from '@/features/groups/domain/permissions'
import type { GroupMembership, GroupSummary, PermissionGroup } from '@/features/groups/domain/types'

/**
 * Queries del slice `groups` (G.2).
 *
 * Solo este archivo + sus hermanos en `server/actions/*` tocan Prisma.
 * El resto del slice (UI, domain) consume vía `public.ts` /
 * `public.server.ts`.
 *
 * `hasPermission` y `listAllowedCategoryIds` viven en `members/server/permissions.ts`
 * (no acá) porque se componen con `findPlaceOwnership` y `findActiveMembership`
 * — primitivas de identity-cache.
 *
 * Cached con `React.cache` cuando el lookup es por primary key — evita
 * roundtrips redundantes en árbol RSC.
 *
 * Ver `docs/features/groups/spec.md` § 11.
 */

type RawGroupRow = {
  id: string
  placeId: string
  name: string
  description: string | null
  permissions: string[]
  isPreset: boolean
  createdAt: Date
  updatedAt: Date
  _count: { groupMemberships: number }
}

const GROUP_SELECT = {
  id: true,
  placeId: true,
  name: true,
  description: true,
  permissions: true,
  isPreset: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { groupMemberships: true } },
} as const

/**
 * Coerciona el array de permissions del row al subset válido del enum.
 * Defensa contra rows legacy o INSERTs manuales con valores fuera de
 * la lista hardcoded — los descartamos silenciosamente en el read path
 * (logueado a futuro si emerge ruido). Las server actions ya validan
 * Zod en el write path.
 */
function coercePermissions(input: string[]): Permission[] {
  return input.filter(isValidPermission)
}

function mapGroupRow(row: RawGroupRow): PermissionGroup {
  return {
    id: row.id,
    placeId: row.placeId,
    name: row.name,
    description: row.description,
    permissions: coercePermissions(row.permissions),
    isPreset: row.isPreset,
    memberCount: row._count.groupMemberships,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * Lista todos los grupos del place. Ordenado: preset primero, después
 * por `createdAt ASC` (más antiguo arriba).
 */
export async function listGroupsByPlace(placeId: string): Promise<PermissionGroup[]> {
  const rows = await prisma.permissionGroup.findMany({
    where: { placeId },
    orderBy: [{ isPreset: 'desc' }, { createdAt: 'asc' }],
    select: GROUP_SELECT,
  })
  return rows.map((row) => mapGroupRow(row as RawGroupRow))
}

/**
 * Encuentra un grupo por id. Devuelve null si no existe. Cached request-
 * scoped — útil cuando una page Y la action la consumen.
 */
export const findGroupById = cache(async (groupId: string): Promise<PermissionGroup | null> => {
  const row = await prisma.permissionGroup.findUnique({
    where: { id: groupId },
    select: GROUP_SELECT,
  })
  if (!row) return null
  return mapGroupRow(row as RawGroupRow)
})

/**
 * Lista los grupos a los que pertenece un user en un place. Útil para
 * `<MemberGroupsControl>` (detalle del miembro). NO incluye permissions
 * — es summary liviano.
 */
export async function listGroupsForUser(userId: string, placeId: string): Promise<GroupSummary[]> {
  const rows = await prisma.groupMembership.findMany({
    where: { userId, placeId },
    select: {
      group: {
        select: { id: true, name: true, isPreset: true },
      },
    },
    orderBy: { addedAt: 'asc' },
  })
  return rows.map((row) => ({
    id: row.group.id,
    name: row.group.name,
    isPreset: row.group.isPreset,
  }))
}

/**
 * Lista los miembros de un grupo. Incluye snapshot de user para mostrar
 * displayName/avatar/handle sin un segundo round-trip. NO N+1.
 *
 * Ordenado por `addedAt ASC` — primer asignado arriba.
 */
export async function listMembershipsByGroup(groupId: string): Promise<GroupMembership[]> {
  const rows = await prisma.groupMembership.findMany({
    where: { groupId },
    orderBy: { addedAt: 'asc' },
    select: {
      id: true,
      groupId: true,
      userId: true,
      placeId: true,
      addedAt: true,
      addedByUserId: true,
      user: {
        select: { displayName: true, handle: true, avatarUrl: true },
      },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    groupId: row.groupId,
    userId: row.userId,
    placeId: row.placeId,
    addedAt: row.addedAt,
    addedByUserId: row.addedByUserId,
    user: {
      displayName: row.user.displayName,
      handle: row.user.handle,
      avatarUrl: row.user.avatarUrl,
    },
  }))
}

/**
 * Batch query: memberships de N groups en 1 round-trip al pooler.
 * Retorna `Map<groupId, GroupMembership[]>`. Groups sin miembros NO
 * aparecen en el Map.
 *
 * Usado por `/settings/groups/page.tsx` para precargar todos los
 * memberships y que el detail panel abra instant (sin extra fetch al
 * tap-row). N=20 groups × 150 max members = 3000 rows worst-case;
 * típicamente bien por debajo.
 *
 * Patrón análogo a `listCategoryScopesByPlace` del slice library
 * (`docs/plans/2026-05-12-library-permissions-redesign.md` § S3).
 */
export async function listMembershipsByGroupIds(
  groupIds: ReadonlyArray<string>,
): Promise<Map<string, GroupMembership[]>> {
  if (groupIds.length === 0) return new Map()
  const rows = await prisma.groupMembership.findMany({
    where: { groupId: { in: [...groupIds] } },
    orderBy: { addedAt: 'asc' },
    select: {
      id: true,
      groupId: true,
      userId: true,
      placeId: true,
      addedAt: true,
      addedByUserId: true,
      user: {
        select: { displayName: true, handle: true, avatarUrl: true },
      },
    },
  })
  const byGroupId = new Map<string, GroupMembership[]>()
  for (const row of rows) {
    const membership: GroupMembership = {
      id: row.id,
      groupId: row.groupId,
      userId: row.userId,
      placeId: row.placeId,
      addedAt: row.addedAt,
      addedByUserId: row.addedByUserId,
      user: {
        displayName: row.user.displayName,
        handle: row.user.handle,
        avatarUrl: row.user.avatarUrl,
      },
    }
    const list = byGroupId.get(row.groupId)
    if (list) list.push(membership)
    else byGroupId.set(row.groupId, [membership])
  }
  return byGroupId
}
