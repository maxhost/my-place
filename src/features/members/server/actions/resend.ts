'use server'

import { revalidatePath } from 'next/cache'
import { logger } from '@/shared/lib/logger'
import { clientEnv } from '@/shared/config/env'
import { ConflictError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { resendInvitationSchema, type ResendInvitationInput } from '@/features/members/schemas'
import { assertInviterHasRole, assertPlaceActive } from '@/features/members/domain/invariants'
import { findInvitationById, findInviterPermissions } from '@/features/members/server/queries'
import { deliverInvitationEmail, fetchInviterDisplayName, requireAuthUserId } from './shared'

/**
 * Reenvía el email de una invitación pending: regenera magic link y vuelve a
 * disparar el mailer. No rota el token — el link del email anterior sigue
 * siendo válido (los magic links de Supabase tienen TTL propio de 1h; el token
 * de `Invitation` vive 7 días).
 */
export async function resendInvitationAction(
  input: unknown,
): Promise<{ ok: true; invitationId: string }> {
  const parsed = resendInvitationSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para reenviar.', { issues: parsed.error.issues })
  }
  const { invitationId }: ResendInvitationInput = parsed.data
  const actorId = await requireAuthUserId('Necesitás iniciar sesión para reenviar.')

  const invitation = await findInvitationById(invitationId)
  if (!invitation) throw new NotFoundError('Invitación no encontrada.', { invitationId })
  assertInvitationResendable(invitation)

  const perms = await findInviterPermissions(actorId, invitation.placeId)
  assertInviterHasRole(perms)

  await deliverInvitationEmail({
    invitationId: invitation.id,
    email: invitation.email,
    redirectTo: `${clientEnv.NEXT_PUBLIC_APP_URL}/invite/accept/${invitation.token}`,
    placeName: invitation.place.name,
    placeSlug: invitation.place.slug,
    inviterDisplayName: await fetchInviterDisplayName(actorId),
    expiresAt: invitation.expiresAt,
  })

  logger.info(
    {
      event: 'invitationResent',
      placeId: invitation.placeId,
      invitationId: invitation.id,
      actorId,
    },
    'invitation resent',
  )

  revalidatePath(`/${invitation.place.slug}/settings/members`)
  return { ok: true, invitationId: invitation.id }
}

/**
 * Checks encapsulados para resend: ya aceptada, expirada, y que el place
 * siga activo. Throws typed errors — el caller propaga.
 */
function assertInvitationResendable(invitation: {
  id: string
  acceptedAt: Date | null
  expiresAt: Date
  place: { archivedAt: Date | null }
}): void {
  if (invitation.acceptedAt) {
    throw new ConflictError('Esta invitación ya fue aceptada.', {
      invitationId: invitation.id,
      reason: 'already_accepted',
    })
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    throw new ValidationError('Esta invitación ya venció.', {
      invitationId: invitation.id,
      reason: 'expired',
    })
  }
  assertPlaceActive(invitation.place)
}
