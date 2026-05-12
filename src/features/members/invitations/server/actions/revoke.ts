'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/db/client'
import { logger } from '@/shared/lib/logger'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'
import { revokeInvitationSchema, type RevokeInvitationInput } from '@/features/members/schemas'
import { findInvitationById } from '@/features/members/server/queries'
import { hasPermission } from '@/features/members/server/permissions'
import { requireAuthUserId } from '@/shared/lib/auth-user'

/**
 * Revoca una invitación pendiente: la elimina de la DB y revalida el panel.
 *
 * El link enviado por email contiene el token `token_hash`; al borrar la
 * invitación de DB el flow `/auth/invite-callback` ya no encuentra el
 * registro y el receptor recibe el error genérico "Invitación no encontrada".
 * No notificamos al receptor activamente (no hay caso de uso para eso hoy).
 *
 * **Permission gating**: el actor debe tener `members:revoke-invitation` o
 * ser owner del place de la invitación. Owner bypass viene de `hasPermission`
 * que aplica la regla "owner = todos los permisos" automáticamente.
 *
 * **No leak de existencia cross-place**: si el actor consulta una invitation
 * que pertenece a OTRO place (no donde el actor tiene permission), el check
 * de permission contra `invitation.placeId` falla con AuthorizationError —
 * NO se filtra que la invitation existe. Mismo patrón que `resend`.
 *
 * **Mutation: delete vs soft-delete**: hoy `prisma.invitation.delete()` —
 * decisión documentada en `docs/plans/2026-05-12-settings-access-redesign.md`
 * § "Open questions". No hay caso de uso para historial post-revoke; si
 * emerge, agregar `revokedAt DateTime?` field con migration.
 */
export async function revokeInvitationAction(
  input: unknown,
): Promise<{ ok: true; invitationId: string }> {
  const parsed = revokeInvitationSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para revocar.', { issues: parsed.error.issues })
  }
  const { invitationId }: RevokeInvitationInput = parsed.data
  const actorId = await requireAuthUserId('Necesitás iniciar sesión para revocar.')

  const invitation = await findInvitationById(invitationId)
  if (!invitation) throw new NotFoundError('Invitación no encontrada.', { invitationId })

  // No leak cross-place: el permission se chequea contra el placeId de la
  // invitation. Si el actor no tiene rol/permiso en ESE place, throws antes
  // de mostrar info de la invitation.
  const allowed = await hasPermission(actorId, invitation.placeId, 'members:revoke-invitation')
  if (!allowed) {
    throw new AuthorizationError('No tenés permiso para revocar invitaciones.', {
      placeId: invitation.placeId,
      actorId,
    })
  }

  // Domain check después del permission (orden importante: si no tiene
  // permission, no le interesa si está aceptada).
  if (invitation.acceptedAt) {
    throw new ConflictError('Esta invitación ya fue aceptada.', {
      invitationId: invitation.id,
      reason: 'already_accepted',
    })
  }

  await prisma.invitation.delete({ where: { id: invitation.id } })

  logger.info(
    {
      event: 'invitationRevoked',
      placeId: invitation.placeId,
      invitationId: invitation.id,
      actorId,
      asOwner: invitation.asOwner,
    },
    'invitation revoked',
  )

  // Mismo path que resend (M.4 rename /settings/members → /settings/access).
  revalidatePath(`/${invitation.place.slug}/settings/access`)
  return { ok: true, invitationId: invitation.id }
}
