'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { logger } from '@/shared/lib/logger'
import { ConflictError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { requireAuthUserId } from '@/shared/lib/auth-user'
import { assertPlaceActive, assertPlaceHasCapacity } from '@/features/members/domain/invariants'
import { acceptInvitationTokenSchema } from '@/features/members/schemas'
import { findActiveMembership, findInvitationByToken } from '@/features/members/server/queries'
import { revalidateMemberPermissions } from '@/features/members/public.server'
import { ADMIN_PRESET_NAME } from '@/features/groups/public'

/**
 * Canjea un token de invitación por una `Membership` activa en el place.
 * Idempotente: aceptar el mismo token dos veces no duplica la membership
 * ni relanza error (retorna `alreadyMember: true`).
 * Ver `docs/features/members/spec.md` § "Aceptar".
 */
export async function acceptInvitationAction(
  token: unknown,
): Promise<{ ok: true; placeSlug: string; alreadyMember: boolean }> {
  const parsed = acceptInvitationTokenSchema.safeParse(token)
  if (!parsed.success) {
    throw new ValidationError('Token de invitación inválido.', { issues: parsed.error.issues })
  }
  const validToken = parsed.data
  const actorId = await requireAuthUserId('Necesitás iniciar sesión para aceptar la invitación.')

  const invitation = await findInvitationByToken(validToken)
  if (!invitation) {
    throw new NotFoundError('Invitación no encontrada.', { reason: 'invalid_token' })
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    throw new ValidationError('La invitación expiró.', {
      reason: 'expired',
      expiresAt: invitation.expiresAt,
    })
  }
  assertPlaceActive(invitation.place)

  if (invitation.acceptedAt) {
    return handleAlreadyAcceptedInvitation(invitation, actorId)
  }

  const alreadyMember = await acceptInvitationTx(invitation, actorId)

  logger.info(
    {
      event: 'invitationAccepted',
      placeId: invitation.placeId,
      invitationId: invitation.id,
      userId: actorId,
      asAdmin: invitation.asAdmin,
      asOwner: invitation.asOwner,
      alreadyMember,
    },
    'invitation accepted',
  )

  revalidatePath('/inbox')
  revalidatePath(`/${invitation.place.slug}`)
  // El layout RSC de `[placeSlug]` computa `isAdmin` con findMemberPermissions.
  // Tras un accept, los perms del actor cambian (nuevo MEMBER/ADMIN) — invalidamos
  // el subtree completo del layout para refrescar TopBar trigger, settings nav, etc.
  revalidatePath(`/${invitation.place.slug}`, 'layout')
  // Invalida el cache cross-request de findMemberPermissions (plan #2.3).
  // Sin esto, el actor vería los perms previos por hasta 60s tras el accept.
  revalidateMemberPermissions(actorId, invitation.placeId)

  return { ok: true, placeSlug: invitation.place.slug, alreadyMember }
}

async function handleAlreadyAcceptedInvitation(
  invitation: { id: string; placeId: string; place: { slug: string } },
  actorId: string,
): Promise<{ ok: true; placeSlug: string; alreadyMember: boolean }> {
  const existing = await findActiveMembership(actorId, invitation.placeId)
  if (existing) {
    logger.info(
      {
        event: 'invitationAccepted',
        placeId: invitation.placeId,
        invitationId: invitation.id,
        userId: actorId,
        alreadyMember: true,
      },
      'invitation idempotent accept',
    )
    return { ok: true, placeSlug: invitation.place.slug, alreadyMember: true }
  }
  throw new ConflictError('Esta invitación ya fue usada por otra persona.', {
    reason: 'already_used',
  })
}

/**
 * Transacción del accept: chequea existing membership (idempotente), valida
 * capacity, crea membership (o no si ya existe), y marca la invitation como
 * acepted. `P2002` sobre Membership indica race con otro accept — se mapea a
 * `ConflictError` typed fuera de la tx.
 *
 * Retorna `alreadyMember=true` si había membership activa previa (idempotente
 * a nivel tx — cubre el caso de que otro tab aceptó entre el pre-check y el tx).
 */
async function acceptInvitationTx(
  invitation: {
    id: string
    placeId: string
    asAdmin: boolean
    asOwner: boolean
    invitedBy: string
  },
  actorId: string,
): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.membership.findFirst({
        where: { userId: actorId, placeId: invitation.placeId, leftAt: null },
        select: { id: true },
      })
      if (existing) {
        await tx.invitation.updateMany({
          where: { id: invitation.id, acceptedAt: null },
          data: { acceptedAt: new Date() },
        })
        return true
      }

      const activeCount = await tx.membership.count({
        where: { placeId: invitation.placeId, leftAt: null },
      })
      assertPlaceHasCapacity(activeCount)

      // Post-cleanup C.3: admin status se modela exclusivamente via
      // GroupMembership al preset "Administradores". La columna
      // `Membership.role` ya no existe. Si la invitation tenía
      // `asAdmin=true` o `asOwner=true`, sumamos GroupMembership al preset.
      // `asOwner=true` además crea PlaceOwnership en la misma tx — el owner
      // recién aceptado queda como co-owner alineado con el patrón de
      // `places/server/actions.ts` (creación de place: ownership + admin
      // preset + membership en una tx).
      await tx.membership.create({
        data: {
          userId: actorId,
          placeId: invitation.placeId,
        },
      })

      const needsAdminPreset = invitation.asAdmin || invitation.asOwner
      if (needsAdminPreset) {
        const adminPreset = await tx.permissionGroup.findFirst({
          where: {
            placeId: invitation.placeId,
            isPreset: true,
            name: ADMIN_PRESET_NAME,
          },
          select: { id: true },
        })
        if (!adminPreset) {
          // Defensa en profundidad: el preset se crea en cada place via
          // `createPlaceAction` (C.3) y se backfilleó vía data migration
          // pre-G.0 para los existentes. Si falta acá, el place está
          // corrupto a nivel data; rollback con copy explícito.
          throw new ConflictError('No se encontró el grupo preset Administradores.', {
            placeId: invitation.placeId,
            reason: 'admin_preset_missing',
          })
        }
        await tx.groupMembership.create({
          data: {
            groupId: adminPreset.id,
            userId: actorId,
            placeId: invitation.placeId,
            addedByUserId: invitation.invitedBy,
          },
        })
      }

      if (invitation.asOwner) {
        await tx.placeOwnership.create({
          data: {
            userId: actorId,
            placeId: invitation.placeId,
          },
        })
      }

      await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      })

      return false
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError(
        'No pudimos crear la membresía (posible carrera o re-joining no soportado).',
        { reason: 'membership_conflict', invitationId: invitation.id },
      )
    }
    throw err
  }
}
