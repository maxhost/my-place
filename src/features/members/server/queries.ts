import 'server-only'
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/db/client'
import {
  findActiveMembership as cachedFindActiveMembership,
  findIsPlaceAdmin,
  findPlaceOwnership,
} from '@/shared/lib/identity-cache'
import type {
  Invitation,
  InvitationDelivery,
  InviterPermissions,
  PendingInvitation,
} from '../domain/types'

/**
 * Queries del slice `members`. Solo este archivo + `actions.ts` tocan Prisma.
 *
 * `findInviterPermissions` compone primitives cached de `identity-cache`.
 * Tiene dos capas de cache: `React.cache` per-request (dedupea callsites del
 * mismo render) y `unstable_cache` cross-request (plan #2.3) taggeado por
 * `(userId, placeId)`. Las server actions que muten
 * Membership/PlaceOwnership/GroupMembership invalidan el tag via
 * `revalidateMemberPermissions` (ver `public.server.ts`).
 *
 * Ver `docs/decisions/2026-04-20-request-scoped-identity-cache.md`.
 */

export async function countActiveMemberships(placeId: string): Promise<number> {
  return prisma.membership.count({
    where: { placeId, leftAt: null },
  })
}

/**
 * Helper interno sin caching externo — el wrapper `unstable_cache` lo envuelve
 * por (userId, placeId). Compone los 3 primitives de identity-cache.
 */
async function findInviterPermissionsRaw(
  userId: string,
  placeId: string,
): Promise<InviterPermissions> {
  const [membership, isOwner, isAdminPreset] = await Promise.all([
    cachedFindActiveMembership(userId, placeId),
    findPlaceOwnership(userId, placeId),
    findIsPlaceAdmin(userId, placeId),
  ])
  return {
    isMember: membership !== null,
    isOwner,
    isAdmin: isOwner || isAdminPreset,
  }
}

/**
 * Cache cross-request via `unstable_cache`. Key: `(userId, placeId)`. Tag
 * `perms:${userId}:${placeId}` invalidado desde actions que muten membership.
 * `revalidate: 60` es floor de safety si el tag se pierde (ej. deploy reset).
 * `React.cache` envuelve por encima para deduplicar dentro del render tree.
 */
export const findInviterPermissions = cache(
  async (userId: string, placeId: string): Promise<InviterPermissions> => {
    return unstable_cache(
      () => findInviterPermissionsRaw(userId, placeId),
      ['perms', userId, placeId],
      {
        tags: [`perms:${userId}:${placeId}`],
        revalidate: 60,
      },
    )()
  },
)

export async function findPlaceStateBySlug(
  slug: string,
): Promise<{ id: string; slug: string; archivedAt: Date | null } | null> {
  return prisma.place.findUnique({
    where: { slug },
    select: { id: true, slug: true, archivedAt: true },
  })
}

export type InvitationWithPlace = Invitation & {
  place: {
    id: string
    slug: string
    name: string
    archivedAt: Date | null
  }
}

export async function findInvitationByToken(token: string): Promise<InvitationWithPlace | null> {
  return prisma.invitation.findUnique({
    where: { token },
    select: {
      id: true,
      placeId: true,
      email: true,
      invitedBy: true,
      asAdmin: true,
      asOwner: true,
      acceptedAt: true,
      expiresAt: true,
      token: true,
      place: { select: { id: true, slug: true, name: true, archivedAt: true } },
    },
  })
}

export type InvitationWithDelivery = Invitation &
  InvitationDelivery & {
    place: { id: string; slug: string; name: string; archivedAt: Date | null }
  }

export async function findInvitationById(
  invitationId: string,
): Promise<InvitationWithDelivery | null> {
  return prisma.invitation.findUnique({
    where: { id: invitationId },
    select: {
      id: true,
      placeId: true,
      email: true,
      invitedBy: true,
      asAdmin: true,
      asOwner: true,
      acceptedAt: true,
      expiresAt: true,
      token: true,
      deliveryStatus: true,
      providerMessageId: true,
      lastDeliveryError: true,
      lastSentAt: true,
      place: { select: { id: true, slug: true, name: true, archivedAt: true } },
    },
  })
}

/**
 * Lista invitaciones abiertas (no aceptadas, no vencidas) de un place, con el
 * `displayName` del inviter para renderizar la row. Se usa en la sección
 * "Invitaciones pendientes" de `/settings/members`.
 *
 * Ahora con `include: { inviter }` (relación declarativa en el schema): un
 * solo round-trip a la DB en lugar de dos serializadas (`findMany` invitations
 * + `findMany` users por batch de IDs).
 */
export async function listPendingInvitationsByPlace(
  placeId: string,
  now: Date = new Date(),
): Promise<PendingInvitation[]> {
  const rows = await prisma.invitation.findMany({
    where: {
      placeId,
      acceptedAt: null,
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      placeId: true,
      email: true,
      invitedBy: true,
      asAdmin: true,
      asOwner: true,
      acceptedAt: true,
      expiresAt: true,
      token: true,
      deliveryStatus: true,
      providerMessageId: true,
      lastDeliveryError: true,
      lastSentAt: true,
      inviter: { select: { displayName: true } },
    },
    orderBy: { expiresAt: 'asc' },
  })
  return rows.map((r) => ({
    id: r.id,
    placeId: r.placeId,
    email: r.email,
    invitedBy: r.invitedBy,
    asAdmin: r.asAdmin,
    asOwner: r.asOwner,
    acceptedAt: r.acceptedAt,
    expiresAt: r.expiresAt,
    token: r.token,
    deliveryStatus: r.deliveryStatus,
    providerMessageId: r.providerMessageId,
    lastDeliveryError: r.lastDeliveryError,
    lastSentAt: r.lastSentAt,
    inviter: { displayName: r.inviter.displayName },
  }))
}

/**
 * Re-export del primitive cached. Histórico de API: `members` expone
 * `findActiveMembership` hace tiempo; seguimos ofreciendo el nombre para que
 * `actions.ts` y tests existentes no cambien.
 */
export const findActiveMembership = cachedFindActiveMembership

export type ActiveMember = {
  userId: string
  membershipId: string
  joinedAt: Date
  isOwner: boolean
  /** Membership al grupo preset del place. Owner ⇒ true. */
  isAdmin: boolean
  user: { displayName: string; handle: string | null; avatarUrl: string | null }
}

/**
 * Lista los miembros activos del place con `isOwner` derivado de
 * `PlaceOwnership` y `isAdmin` derivado de `GroupMembership` al preset.
 * Ordenado por antigüedad ascendente — el primer miembro es el creador
 * (o quien haya quedado como owner más antiguo tras transferencias).
 */
export async function listActiveMembers(placeId: string): Promise<ActiveMember[]> {
  const [memberships, ownerships, presetMemberships] = await Promise.all([
    prisma.membership.findMany({
      where: { placeId, leftAt: null },
      include: {
        user: { select: { displayName: true, handle: true, avatarUrl: true } },
      },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.placeOwnership.findMany({
      where: { placeId },
      select: { userId: true },
    }),
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
      user: m.user,
    }
  })
}

export type MemberProfile = {
  userId: string
  membershipId: string
  joinedAt: Date
  isOwner: boolean
  /** Membership al grupo preset del place. Owner ⇒ true. */
  isAdmin: boolean
  user: { displayName: string; handle: string | null; avatarUrl: string | null }
}

/**
 * Retorna el perfil contextual de un miembro activo en un place. Si el `userId` no
 * tiene `Membership` activa en ese `placeId`, retorna `null` — la ruta de perfil
 * interpreta eso como 404 (principio: sin perfil público fuera de places).
 */
export async function findMemberProfile(
  placeId: string,
  userId: string,
): Promise<MemberProfile | null> {
  const [membership, ownership, isAdminPreset] = await Promise.all([
    prisma.membership.findFirst({
      where: { userId, placeId, leftAt: null },
      select: {
        id: true,
        joinedAt: true,
        user: { select: { displayName: true, handle: true, avatarUrl: true } },
      },
    }),
    prisma.placeOwnership.findUnique({
      where: { userId_placeId: { userId, placeId } },
      select: { userId: true },
    }),
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
    user: membership.user,
  }
}
