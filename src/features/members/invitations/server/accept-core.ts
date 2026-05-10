import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { logger } from '@/shared/lib/logger'
import { ConflictError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { assertPlaceActive, assertPlaceHasCapacity } from '@/features/members/domain/invariants'
import { acceptInvitationTokenSchema } from '@/features/members/schemas'
import { findActiveMembership, findInvitationByToken } from '@/features/members/server/queries'
import { ADMIN_PRESET_NAME } from '@/features/groups/public'

export type AcceptInvitationCoreResult = {
  ok: true
  placeSlug: string
  placeId: string
  alreadyMember: boolean
}

/**
 * Core de la aceptación de una invitación: parse, valida, ejecuta la
 * transacción. NO hace auth (recibe `actorId` ya validado) ni invalidación de
 * cache. Pensado para ser invocado desde:
 *  - Server actions (`acceptInvitationAction`): wrapper agrega `requireAuthUserId`
 *    + `revalidatePath` + `revalidateMemberPermissions`.
 *  - Route handlers (`/auth/invite-callback`): el callback acepta inline y
 *    redirige al place sin pasar por la accept page.
 *
 * Tira los mismos errores typed que el action histórico (mantiene contrato):
 *  - `ValidationError` (token inválido o expirada)
 *  - `NotFoundError` (token no existe)
 *  - `ConflictError` (place archivado, ya usada por otro, missing preset, race P2002)
 *  - `InvariantViolation` (place al cap de 150 — propagado desde `assertPlaceHasCapacity`)
 *
 * Ver `docs/features/members/spec.md` § "Aceptar".
 */
export async function acceptInvitationCore(
  token: unknown,
  actorId: string,
): Promise<AcceptInvitationCoreResult> {
  const parsed = acceptInvitationTokenSchema.safeParse(token)
  if (!parsed.success) {
    throw new ValidationError('Token de invitación inválido.', { issues: parsed.error.issues })
  }
  const validToken = parsed.data

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

  return {
    ok: true,
    placeSlug: invitation.place.slug,
    placeId: invitation.placeId,
    alreadyMember,
  }
}

async function handleAlreadyAcceptedInvitation(
  invitation: { id: string; placeId: string; place: { slug: string } },
  actorId: string,
): Promise<AcceptInvitationCoreResult> {
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
    return {
      ok: true,
      placeSlug: invitation.place.slug,
      placeId: invitation.placeId,
      alreadyMember: true,
    }
  }
  throw new ConflictError('Esta invitación ya fue usada por otra persona.', {
    reason: 'already_used',
  })
}

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
