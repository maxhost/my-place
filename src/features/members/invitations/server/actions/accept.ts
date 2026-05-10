'use server'

import { revalidatePath } from 'next/cache'
import { ValidationError } from '@/shared/errors/domain-error'
import { requireAuthUserId } from '@/shared/lib/auth-user'
import { acceptInvitationTokenSchema } from '@/features/members/schemas'
import { acceptInvitationCore } from '../accept-core'
import { revalidateMemberPermissions } from '@/features/members/public.server'

/**
 * Canjea un token de invitación por una `Membership` activa en el place.
 * Idempotente: aceptar el mismo token dos veces no duplica la membership
 * ni relanza error (retorna `alreadyMember: true`).
 *
 * Wrapper sobre `acceptInvitationCore` que agrega:
 *  - `requireAuthUserId` (auth context del action)
 *  - `revalidatePath` + `revalidateMemberPermissions` (cache invalidation)
 *
 * El core es reutilizable desde el route handler `/auth/invite-callback`
 * para hacer accept inline post-verifyOtp (eliminar PÁGINA 2 del flow).
 *
 * Ver `docs/features/members/spec.md` § "Aceptar".
 */
export async function acceptInvitationAction(
  token: unknown,
): Promise<{ ok: true; placeSlug: string; alreadyMember: boolean }> {
  // Parse token PRIMERO (antes de auth) para preservar el orden de errores del
  // contrato original: token inválido → ValidationError sin tocar Supabase.
  const parsed = acceptInvitationTokenSchema.safeParse(token)
  if (!parsed.success) {
    throw new ValidationError('Token de invitación inválido.', { issues: parsed.error.issues })
  }

  const actorId = await requireAuthUserId('Necesitás iniciar sesión para aceptar la invitación.')

  const result = await acceptInvitationCore(parsed.data, actorId)

  revalidatePath('/inbox')
  revalidatePath(`/${result.placeSlug}`)
  // El layout RSC de `[placeSlug]` computa `isAdmin` con findMemberPermissions.
  // Tras un accept, los perms del actor cambian (nuevo MEMBER/ADMIN) — invalidamos
  // el subtree completo del layout para refrescar TopBar trigger, settings nav, etc.
  revalidatePath(`/${result.placeSlug}`, 'layout')
  // Invalida el cache cross-request de findMemberPermissions (plan #2.3).
  // Sin esto, el actor vería los perms previos por hasta 60s tras el accept.
  revalidateMemberPermissions(actorId, result.placeId)

  return { ok: true, placeSlug: result.placeSlug, alreadyMember: result.alreadyMember }
}
