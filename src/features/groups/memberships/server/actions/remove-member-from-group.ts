'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/db/client'
import { requireAuthUserId } from '@/shared/lib/auth-user'
import { findPlaceOwnership } from '@/shared/lib/identity-cache'
import { loadPlaceById } from '@/shared/lib/place-loader'
import { logger } from '@/shared/lib/logger'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { removeMemberFromGroupInputSchema } from '@/features/groups/schemas'
import { revalidateMemberPermissions } from '@/features/members/public.server'

/**
 * Resultado de `removeMemberFromGroupAction` — discriminated union.
 *
 * - `not_in_group`: el `(groupId, userId)` no existe (ya fue removido por
 *   otra operación, o el target nunca estuvo). Idempotente desde la
 *   perspectiva del owner.
 */
export type RemoveMemberFromGroupResult = { ok: true } | { ok: false; error: 'not_in_group' }

/**
 * Remueve un user de un grupo. Owner-only.
 *
 * Identifica el row por `(groupId, userId)` (compuesto unique). Catch
 * P2025 → `not_in_group` (Prisma tira `RecordNotFound` cuando el delete
 * no matchea ninguna fila).
 */
export async function removeMemberFromGroupAction(
  input: unknown,
): Promise<RemoveMemberFromGroupResult> {
  const parsed = removeMemberFromGroupInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para remover miembro de grupo.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const actorId = await requireAuthUserId(
    'Necesitás iniciar sesión para remover miembros de grupos.',
  )

  const group = await prisma.permissionGroup.findUnique({
    where: { id: data.groupId },
    select: { id: true, placeId: true },
  })
  if (!group) {
    throw new NotFoundError('Grupo no encontrado.', { groupId: data.groupId })
  }

  const place = await loadPlaceById(group.placeId)
  if (!place || place.archivedAt) {
    throw new NotFoundError('Place no encontrado.', { placeId: group.placeId })
  }

  const isOwner = await findPlaceOwnership(actorId, place.id)
  if (!isOwner) {
    throw new AuthorizationError('Solo el owner puede remover miembros de grupos.', {
      placeId: place.id,
      groupId: group.id,
      actorId,
    })
  }

  try {
    await prisma.groupMembership.delete({
      where: {
        groupId_userId: { groupId: group.id, userId: data.userId },
      },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return { ok: false, error: 'not_in_group' }
    }
    throw err
  }

  logger.info(
    {
      event: 'groupMembershipRemoved',
      placeId: place.id,
      groupId: group.id,
      memberUserId: data.userId,
      actorId,
    },
    'group membership removed',
  )

  revalidatePath(`/${place.slug}/settings/groups`)
  revalidatePath(`/${place.slug}/settings/groups/${group.id}`)
  revalidatePath(`/${place.slug}/settings/members/${data.userId}`)
  // Plan #2.3: si el grupo era el preset, isAdmin del target cambia.
  // Por simetría/seguridad invalidamos siempre — costo nulo.
  revalidateMemberPermissions(data.userId, place.id)
  return { ok: true }
}
