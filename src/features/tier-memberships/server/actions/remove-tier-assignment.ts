'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/db/client'
import { requireAuthUserId } from '@/shared/lib/auth-user'
import { findPlaceOwnership } from '@/shared/lib/identity-cache'
import { loadPlaceById } from '@/shared/lib/place-loader'
import { logger } from '@/shared/lib/logger'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { removeTierAssignmentInputSchema } from '@/features/tier-memberships/schemas'
import { revalidateTierAssignmentsCache } from '@/features/tier-memberships/server/cache'

/**
 * Resultado de `removeTierAssignmentAction` — discriminated union.
 *
 * - `assignment_not_found`: el `tierMembershipId` no existe (ya fue
 *   removido por otra operación, o el id es bogus). Idempotente desde la
 *   perspectiva del owner — la UI puede mostrar copy "ya estaba removido".
 *
 * Errores **inesperados** (auth, place archivado) siguen como throw.
 */
export type RemoveTierAssignmentResult = { ok: true } | { ok: false; error: 'assignment_not_found' }

/**
 * Remueve una asignación de tier. Owner-only.
 *
 * Identifica el row a remover por `tierMembershipId` explícito (no por
 * `(tierId, userId)` — evita race con asignación concurrente, decisión #15
 * ADR). Si dos owners A y B operan al mismo tiempo:
 *  1. A remueve `(tier=X, user=Y)`.
 *  2. B asigna `(tier=X, user=Y)` justo después.
 *
 * Con `tierMembershipId` explícito, A sólo borra el row específico que vio
 * en su UI — no toca el row recién creado por B.
 *
 * Flow:
 *  1. Parse Zod del input.
 *  2. Auth: `requireAuthUserId`.
 *  3. Carga el row para conocer su `placeId` y `userId` (para revalidate).
 *     Si no existe → `assignment_not_found`.
 *  4. Resuelve el place — `NotFoundError` si está archivado (no debería
 *     pasar dado que el row apunta a un place existente).
 *  5. Owner gate: `findPlaceOwnership(actor, placeId)` — `AuthorizationError`
 *     si no es owner.
 *  6. DELETE del row + log + revalida la page detalle del miembro.
 *
 * Ver `docs/features/tier-memberships/spec.md` § 10.
 */
export async function removeTierAssignmentAction(
  input: unknown,
): Promise<RemoveTierAssignmentResult> {
  const parsed = removeTierAssignmentInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para remover asignación.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const actorId = await requireAuthUserId('Necesitás iniciar sesión para remover asignaciones.')

  const tierMembership = await prisma.tierMembership.findUnique({
    where: { id: data.tierMembershipId },
    select: { id: true, placeId: true, userId: true, tierId: true },
  })
  if (!tierMembership) {
    return { ok: false, error: 'assignment_not_found' }
  }

  const place = await loadPlaceById(tierMembership.placeId)
  if (!place || place.archivedAt) {
    throw new NotFoundError('Place no encontrado.', { placeId: tierMembership.placeId })
  }

  const isOwner = await findPlaceOwnership(actorId, place.id)
  if (!isOwner) {
    throw new AuthorizationError('Solo el owner puede remover asignaciones.', {
      placeId: place.id,
      tierMembershipId: tierMembership.id,
      actorId,
    })
  }

  await prisma.tierMembership.delete({ where: { id: tierMembership.id } })

  logger.info(
    {
      event: 'tierMembershipRemoved',
      placeId: place.id,
      tierMembershipId: tierMembership.id,
      tierId: tierMembership.tierId,
      memberUserId: tierMembership.userId,
      actorId,
    },
    'tier membership removed',
  )

  revalidatePath(`/${place.slug}/settings/members/${tierMembership.userId}`)
  revalidateTierAssignmentsCache(place.id, tierMembership.userId)
  return { ok: true }
}
