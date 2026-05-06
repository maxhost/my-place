'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/db/client'
import { requireAuthUserId } from '@/shared/lib/auth-user'
import { findPlaceOwnership } from '@/shared/lib/identity-cache'
import { loadPlaceById } from '@/shared/lib/place-loader'
import { logger } from '@/shared/lib/logger'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { expelMemberInputSchema } from '@/features/members/schemas'
import { revalidateMemberPermissions } from '@/features/members/public.server'
import { sendExpelEmail } from '../mailer/expel-email'

/**
 * Expulsa a un miembro del place. **Owner-only HARDCODED** (decisión
 * #8 ADR PermissionGroups — NO es permiso atómico delegable).
 * Plan G.4 — PermissionGroups.
 *
 * Equivale a un leave forzado: setea `Membership.leftAt = now()` +
 * `expelledByUserId`, `expelReason`, `expelContactEmail`. La distinción
 * entre leave voluntario y expel se hace por `expelledByUserId IS NOT NULL`.
 *
 * No es reversible — el ex-miembro debe ser re-invitado para volver.
 * Tras 365d entra al flujo normal de erasure.
 *
 * Email Resend al expulsado: try/catch, mismo patrón que block. La acción
 * commitea aunque el email falle (la expulsión es la intención principal).
 *
 * Discriminated union para errores esperados.
 *
 * Spec: docs/features/groups/spec.md § 12, § 14.
 * ADR: decisiones #8 (owner-only), #11 (leftAt + metadata).
 */
export type ExpelMemberResult =
  | { ok: true }
  | {
      ok: false
      error: 'cannot_expel_owner' | 'cannot_expel_self' | 'target_user_not_member'
    }

export async function expelMemberAction(input: unknown): Promise<ExpelMemberResult> {
  const parsed = expelMemberInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para expulsar miembro.', {
      issues: parsed.error.issues,
    })
  }
  const { placeId, memberUserId, reason, contactEmail } = parsed.data

  const actorId = await requireAuthUserId('Necesitás iniciar sesión para expulsar miembros.')

  const place = await loadPlaceById(placeId)
  if (!place || place.archivedAt) {
    throw new NotFoundError('Place no encontrado.', { placeId })
  }

  // Owner-only HARDCODED — NO permiso atómico (decisión #8 ADR).
  // Sin fallback, sin grupos delegables.
  const isActorOwner = await findPlaceOwnership(actorId, place.id)
  if (!isActorOwner) {
    throw new AuthorizationError('Solo el owner puede expulsar miembros.', {
      placeId: place.id,
      actorId,
    })
  }

  if (memberUserId === actorId) {
    return { ok: false, error: 'cannot_expel_self' }
  }

  const isTargetOwner = await findPlaceOwnership(memberUserId, place.id)
  if (isTargetOwner) {
    return { ok: false, error: 'cannot_expel_owner' }
  }

  const targetMembership = await prisma.membership.findFirst({
    where: { userId: memberUserId, placeId: place.id, leftAt: null },
    select: { id: true, user: { select: { email: true } } },
  })
  if (!targetMembership) {
    return { ok: false, error: 'target_user_not_member' }
  }

  await prisma.membership.update({
    where: { id: targetMembership.id },
    data: {
      leftAt: new Date(),
      expelledByUserId: actorId,
      expelReason: reason,
      expelContactEmail: contactEmail,
    },
  })

  logger.info(
    {
      event: 'memberExpelled',
      placeId: place.id,
      memberUserId,
      actorId,
    },
    'member expelled',
  )

  try {
    await sendExpelEmail({
      to: targetMembership.user.email,
      placeName: place.name,
      reason,
      contactEmail,
    })
  } catch (err) {
    logger.warn(
      {
        event: 'memberExpelledEmailFailed',
        placeId: place.id,
        memberUserId,
        actorId,
        err: err instanceof Error ? err.message : String(err),
      },
      'expel notice email failed — expel already committed',
    )
  }

  // Revalida directorio + inbox del actor (membership ya no aparece como activa).
  revalidatePath(`/${place.slug}/settings/members`)
  revalidatePath(`/${place.slug}/settings/members/${memberUserId}`)
  revalidatePath('/inbox')
  // Plan #2.3: el ex-miembro ya no tiene perms — invalidar su tag cross-request.
  // Sin esto, si el expulsado entra al place dentro de los 60s siguientes vería
  // el cache previo (isMember=true) hasta que expirara el `revalidate` floor.
  revalidateMemberPermissions(memberUserId, place.id)
  return { ok: true }
}
