import 'server-only'
import { cache } from 'react'
import { prisma } from '@/db/client'
import type { MembershipRole } from '@prisma/client'
import {
  findActiveMembership as cachedFindActiveMembership,
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
 * `findInviterPermissions` compone primitives cached de `shared/lib/identity-cache`
 * para que el árbol layout → gated layout → page → action reuse los mismos
 * round-trips dentro de un request. El wrapping propio de `cache()` acá dedupea
 * la llamada compuesta cuando dos callsites piden los mismos args.
 *
 * Ver `docs/decisions/2026-04-20-request-scoped-identity-cache.md`.
 */

export async function countActiveMemberships(placeId: string): Promise<number> {
  return prisma.membership.count({
    where: { placeId, leftAt: null },
  })
}

export const findInviterPermissions = cache(
  async (userId: string, placeId: string): Promise<InviterPermissions> => {
    const [membership, isOwner] = await Promise.all([
      cachedFindActiveMembership(userId, placeId),
      findPlaceOwnership(userId, placeId),
    ])
    return { role: membership?.role ?? null, isOwner }
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
      acceptedAt: true,
      expiresAt: true,
      token: true,
      deliveryStatus: true,
      providerMessageId: true,
      lastDeliveryError: true,
      lastSentAt: true,
    },
    orderBy: { expiresAt: 'asc' },
  })
  if (rows.length === 0) return []
  // No hay relación `inviter` en el schema — lookup explícito por batch.
  const inviterIds = Array.from(new Set(rows.map((r) => r.invitedBy)))
  const inviters = await prisma.user.findMany({
    where: { id: { in: inviterIds } },
    select: { id: true, displayName: true },
  })
  const nameById = new Map(inviters.map((u) => [u.id, u.displayName]))
  return rows.map((r) => ({
    id: r.id,
    placeId: r.placeId,
    email: r.email,
    invitedBy: r.invitedBy,
    asAdmin: r.asAdmin,
    acceptedAt: r.acceptedAt,
    expiresAt: r.expiresAt,
    token: r.token,
    deliveryStatus: r.deliveryStatus,
    providerMessageId: r.providerMessageId,
    lastDeliveryError: r.lastDeliveryError,
    lastSentAt: r.lastSentAt,
    inviter: { displayName: nameById.get(r.invitedBy) ?? '—' },
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
  role: MembershipRole
  joinedAt: Date
  isOwner: boolean
  user: { displayName: string; handle: string | null; avatarUrl: string | null }
}

/**
 * Lista los miembros activos del place con `isOwner` derivado de `PlaceOwnership`.
 * Ordenado por antigüedad ascendente — el primer miembro es el creador (o quien
 * haya quedado como owner más antiguo tras transferencias).
 */
export async function listActiveMembers(placeId: string): Promise<ActiveMember[]> {
  const [memberships, ownerships] = await Promise.all([
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
  ])
  const ownerIds = new Set(ownerships.map((o) => o.userId))
  return memberships.map((m) => ({
    userId: m.userId,
    membershipId: m.id,
    role: m.role,
    joinedAt: m.joinedAt,
    isOwner: ownerIds.has(m.userId),
    user: m.user,
  }))
}

export type MemberProfile = {
  userId: string
  membershipId: string
  role: MembershipRole
  joinedAt: Date
  isOwner: boolean
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
  const [membership, ownership] = await Promise.all([
    prisma.membership.findFirst({
      where: { userId, placeId, leftAt: null },
      select: {
        id: true,
        role: true,
        joinedAt: true,
        user: { select: { displayName: true, handle: true, avatarUrl: true } },
      },
    }),
    prisma.placeOwnership.findUnique({
      where: { userId_placeId: { userId, placeId } },
      select: { userId: true },
    }),
  ])
  if (!membership) return null
  return {
    userId,
    membershipId: membership.id,
    role: membership.role,
    joinedAt: membership.joinedAt,
    isOwner: !!ownership,
    user: membership.user,
  }
}
