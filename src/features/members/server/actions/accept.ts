'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { logger } from '@/shared/lib/logger'
import { ConflictError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { requireAuthUserId } from '@/shared/lib/auth-user'
import { assertPlaceActive, assertPlaceHasCapacity } from '@/features/members/domain/invariants'
import { findActiveMembership, findInvitationByToken } from '@/features/members/server/queries'
import { revalidateMemberPermissions } from '@/features/members/public.server'

/**
 * Canjea un token de invitación por una `Membership` activa en el place.
 * Idempotente: aceptar el mismo token dos veces no duplica la membership
 * ni relanza error (retorna `alreadyMember: true`).
 * Ver `docs/features/members/spec.md` § "Aceptar".
 */
export async function acceptInvitationAction(
  token: unknown,
): Promise<{ ok: true; placeSlug: string; alreadyMember: boolean }> {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new ValidationError('Token de invitación inválido.')
  }
  const actorId = await requireAuthUserId('Necesitás iniciar sesión para aceptar la invitación.')

  const invitation = await findInvitationByToken(token)
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
      role: invitation.asAdmin ? 'ADMIN' : 'MEMBER',
      alreadyMember,
    },
    'invitation accepted',
  )

  revalidatePath('/inbox')
  revalidatePath(`/${invitation.place.slug}`)
  // Plan #2.3: invalidar el cache cross-request de findMemberPermissions.
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
  invitation: { id: string; placeId: string; asAdmin: boolean },
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

      await tx.membership.create({
        data: {
          userId: actorId,
          placeId: invitation.placeId,
        },
      })

      // Si la invitación es admin, sumamos al user al PermissionGroup preset
      // del place. El preset tiene `permissions: PERMISSIONS_ALL` y se crea
      // junto al place (ver `places/server/actions:createPlaceAction`); si
      // por algún motivo no existe (caso edge muy raro de scaffolding), lo
      // dejamos pasar con un warn — el accept no debe fallar por eso, ya
      // que el owner puede asignar grupos manualmente desde /settings/access.
      if (invitation.asAdmin) {
        const preset = await tx.permissionGroup.findFirst({
          where: { placeId: invitation.placeId, isPreset: true },
          select: { id: true },
        })
        if (preset) {
          await tx.groupMembership.create({
            data: {
              userId: actorId,
              placeId: invitation.placeId,
              groupId: preset.id,
            },
          })
        } else {
          logger.warn(
            { placeId: invitation.placeId, invitationId: invitation.id },
            'admin invitation accepted but preset group missing',
          )
        }
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
