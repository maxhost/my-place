import 'server-only'
import { prisma } from '@/db/client'
import { findIsPlaceAdmin } from '@/shared/lib/identity-cache'

/**
 * Queries del directorio de miembros (M.3).
 *
 * Split del `queries.ts` legacy para no superar el cap de 300 LOC tras M.3.
 * Convive con `queries.ts` (invitaciones, perfil simple, listado plano) — el
 * `public.server.ts` re-exporta desde ambos.
 *
 * Plan: docs/plans/2026-05-02-tier-memberships-and-directory.md § M.3.
 * Spec: docs/features/tier-memberships/spec.md § 9, 10.
 * ADR:  docs/decisions/2026-05-02-tier-memberships-model.md
 *       (decisión #6 privacidad, #7 búsqueda, #8 filtros).
 */

export type MemberSearchParams = {
  q?: string
  /**
   * Filtra miembros que pertenezcan al permission group con este ID. Reemplaza
   * al legacy `isAdmin` (decisión 2026-05-04): admin se modela como membership
   * al preset "Administradores", que aparece como opción más en el dropdown
   * de grupos. `groupId` no exclusivo: un owner sin GroupMembership al preset
   * (artefacto histórico) NO aparece bajo ningún groupId — usar el filtro de
   * "Owners" en `/settings/access` para esos casos. El filtro NO incluye
   * `PlaceOwnership` por diseño: el dropdown habla del modelo de grupos.
   */
  groupId?: string
  tierId?: string
  joinedSince?: '7d' | '30d' | '90d' | '1y'
}

export type MemberSummary = {
  userId: string
  membershipId: string
  joinedAt: Date
  isOwner: boolean
  /** Membership al grupo preset "Administradores" del place. Owner ⇒ true. */
  isAdmin: boolean
  user: { displayName: string; handle: string | null; avatarUrl: string | null }
  tierCount: number
}

export type MemberDetail = {
  userId: string
  membershipId: string
  joinedAt: Date
  isOwner: boolean
  /** Membership al grupo preset "Administradores" del place. Owner ⇒ true. */
  isAdmin: boolean
  user: { displayName: string; handle: string | null; avatarUrl: string | null }
}

const JOINED_SINCE_DAYS: Record<NonNullable<MemberSearchParams['joinedSince']>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
}

/**
 * Busca miembros activos del place según `MemberSearchParams`. Server-side
 * con `OR ILIKE` sobre `User.displayName` y `User.handle`. NO email
 * (privacidad — decisión #6 del ADR).
 *
 * **Connection-limit gotcha (CLAUDE.md)**: 1 query Prisma para memberships +
 * 1 para PlaceOwnership (derivar `isOwner`). Sin N+1 — las relaciones
 * `user._count.tierMemberships` viajan en el mismo SELECT vía `_count`.
 *
 * Ordenado por `joinedAt: 'asc'` — primer miembro es el más antiguo.
 */
export async function searchMembers(
  placeId: string,
  params: MemberSearchParams,
): Promise<MemberSummary[]> {
  const userWhere = buildUserWhere(placeId, params)
  const joinedAtFilter = buildJoinedAtFilter(params.joinedSince)

  const [memberships, ownerships, presetMemberships] = await Promise.all([
    prisma.membership.findMany({
      where: {
        placeId,
        leftAt: null,
        ...(userWhere ? { user: userWhere } : {}),
        ...(joinedAtFilter ? { joinedAt: joinedAtFilter } : {}),
      },
      include: {
        user: {
          select: {
            displayName: true,
            handle: true,
            avatarUrl: true,
            _count: {
              select: {
                tierMemberships: {
                  where: { placeId },
                },
              },
            },
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.placeOwnership.findMany({
      where: { placeId },
      select: { userId: true },
    }),
    // 3ra query: usuarios del place que están en el grupo preset
    // "Administradores" (deriva `isAdmin`). Filtro por place + group.isPreset,
    // sólo trae el `userId`. 1 round-trip plano.
    prisma.groupMembership.findMany({
      where: { placeId, group: { isPreset: true } },
      select: { userId: true },
    }),
  ])
  const ownerIds = new Set(ownerships.map((o) => o.userId))
  const adminUserIds = new Set(presetMemberships.map((g) => g.userId))
  return memberships.map((m) => {
    const isOwner = ownerIds.has(m.userId)
    return {
      userId: m.userId,
      membershipId: m.id,
      joinedAt: m.joinedAt,
      isOwner,
      isAdmin: isOwner || adminUserIds.has(m.userId),
      user: {
        displayName: m.user.displayName,
        handle: m.user.handle,
        avatarUrl: m.user.avatarUrl,
      },
      tierCount: m.user._count.tierMemberships,
    }
  })
}

/**
 * Construye el WHERE sobre `User` para `searchMembers`. Combina el filtro de
 * búsqueda libre (`q`), el filtro por `groupId` (membership al permission
 * group del place) y el filtro por `tierId` (si presente). Retorna
 * `undefined` si no hay nada para filtrar — así el caller puede omitir el
 * key entero del WHERE.
 *
 * **Filtro `groupId`** (decisión 2026-05-04): reemplaza al legacy
 * `isAdmin`. Admin = membership al preset "Administradores", que aparece
 * como una opción más en el dropdown de grupos. La relación es directa
 * (`User.groupMemberships.some({ placeId, groupId })`) — sin OR a
 * `PlaceOwnership` por diseño: el dropdown habla del modelo de grupos.
 * Owner sin GroupMembership al preset (artefacto histórico raro) NO
 * aparece bajo ningún groupId; el viewer-owner lo identifica vía la lista
 * separada de owners en `/settings/access`.
 */
function buildUserWhere(
  placeId: string,
  params: MemberSearchParams,
): Record<string, unknown> | undefined {
  const conditions: Record<string, unknown> = {}
  const trimmed = params.q?.trim()
  if (trimmed && trimmed.length > 0) {
    conditions.OR = [
      { displayName: { contains: trimmed, mode: 'insensitive' } },
      { handle: { contains: trimmed, mode: 'insensitive' } },
    ]
  }
  if (params.groupId) {
    conditions.groupMemberships = {
      some: { placeId, groupId: params.groupId },
    }
  }
  if (params.tierId) {
    conditions.tierMemberships = {
      some: {
        tierId: params.tierId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    }
  }
  return Object.keys(conditions).length > 0 ? conditions : undefined
}

function buildJoinedAtFilter(
  joinedSince: MemberSearchParams['joinedSince'],
): { gte: Date } | undefined {
  if (!joinedSince) return undefined
  const days = JOINED_SINCE_DAYS[joinedSince]
  return { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
}

/**
 * Carga el detalle del miembro para uso del owner. **2 queries Prisma** en
 * paralelo (`Promise.all`):
 *  1. `membership.findFirst` con `include` anidado de
 *     `user.tierMemberships(where placeId).include(tier)` — trae todo el
 *     payload del miembro + sus tiers asignados en el place en 1 round-trip.
 *  2. `placeOwnership.findUnique` para derivar `isOwner`.
 *
 * **Connection-limit gotcha (CLAUDE.md)**: el `include` anidado evita N+1.
 * Test verifica con Prisma spy que son exactamente 2 queries. El `Promise.all`
 * las paraleliza — sobre el pooler `connection_limit=1` corren serializadas,
 * pero siguen siendo 2 round-trips en lugar de N (el riesgo gotcha es N+1
 * por iteración, no la paralelización).
 *
 * **Privacidad (decisión #6 ADR)**: NO selecciona `user.email`. El owner ve
 * displayName + handle + avatarUrl + role + isOwner + tiers.
 */
export async function findMemberDetailForOwner(
  userId: string,
  placeId: string,
): Promise<MemberDetail | null> {
  const [membership, ownership, isAdminPreset] = await Promise.all([
    prisma.membership.findFirst({
      where: { userId, placeId, leftAt: null },
      select: {
        id: true,
        joinedAt: true,
        user: {
          select: {
            displayName: true,
            handle: true,
            avatarUrl: true,
          },
        },
      },
    }),
    prisma.placeOwnership.findUnique({
      where: { userId_placeId: { userId, placeId } },
      select: { userId: true },
    }),
    // Membership al grupo preset → derive `isAdmin`. Cached primitive
    // reusable entre layout / page / action en el mismo request.
    findIsPlaceAdmin(userId, placeId),
  ])
  if (!membership) return null

  const isOwner = !!ownership
  return {
    userId,
    membershipId: membership.id,
    joinedAt: membership.joinedAt,
    isOwner,
    isAdmin: isOwner || isAdminPreset,
    user: {
      displayName: membership.user.displayName,
      handle: membership.user.handle,
      avatarUrl: membership.user.avatarUrl,
    },
  }
}

// ---------------------------------------------------------------
// G.6 — Block info de un miembro arbitrario (no del viewer).
// ---------------------------------------------------------------

export type MemberBlockInfo = {
  blockedAt: Date
  blockedReason: string | null
  blockedContactEmail: string | null
  blockedByUserId: string | null
  blockedByDisplayName: string | null
}

/**
 * Retorna la info de bloqueo de un miembro arbitrario del place. Usado por
 * la sección "Bloquear miembro" en `/settings/members/[userId]` para mostrar
 * "Bloqueado el [date] por [...]" cuando el target ya está bloqueado.
 *
 * Distinto de `findViewerBlockState` (este chequea cualquier `userId`, aquel
 * sólo el viewer logueado para el gate del layout).
 *
 * Retorna `null` si:
 *  - El user no tiene `Membership` en el place.
 *  - O la membership tiene `blockedAt IS NULL`.
 *
 * Trae `blockedByDisplayName` resolviendo la relación `blockedBy` inline
 * (1 sola query con JOIN). Antes esto eran 2 queries serializadas (lookup
 * de membership + lookup de User por id).
 */
export async function findMemberBlockInfo(
  userId: string,
  placeId: string,
): Promise<MemberBlockInfo | null> {
  const row = await prisma.membership.findFirst({
    where: { userId, placeId, leftAt: null },
    select: {
      blockedAt: true,
      blockedReason: true,
      blockedContactEmail: true,
      blockedByUserId: true,
      blockedBy: { select: { displayName: true } },
    },
  })
  if (!row || row.blockedAt === null) return null

  return {
    blockedAt: row.blockedAt,
    blockedReason: row.blockedReason,
    blockedContactEmail: row.blockedContactEmail,
    blockedByUserId: row.blockedByUserId,
    blockedByDisplayName: row.blockedBy?.displayName ?? null,
  }
}
