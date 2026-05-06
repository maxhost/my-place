'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/db/client'
import { requireAuthUserId } from '@/shared/lib/auth-user'
import { findActiveMembership, findPlaceOwnership } from '@/shared/lib/identity-cache'
import { loadPlaceById } from '@/shared/lib/place-loader'
import { logger } from '@/shared/lib/logger'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { addMemberToGroupInputSchema } from '@/features/groups/schemas'
import { revalidateMemberPermissions } from '@/features/members/public.server'

/**
 * Resultado de `addMemberToGroupAction` — discriminated union.
 *
 * - `target_user_not_member`: el target no es miembro activo del place
 *   (sin row de Membership o `leftAt !== null`).
 * - `target_is_owner`: el target es owner del place. Owner es "dios
 *   implícito" (decisión #2 ADR) — NO se le asignan grupos.
 * - `already_in_group`: el `(groupId, userId)` ya existe — viola el
 *   `@@unique([groupId, userId])`. Catch P2002 cubre el race.
 */
export type AddMemberToGroupResult =
  | { ok: true }
  | {
      ok: false
      error: 'target_user_not_member' | 'target_is_owner' | 'already_in_group'
    }

/**
 * Asigna un user a un grupo. Owner-only.
 *
 * Flow:
 *  1. Parse Zod.
 *  2. Auth + load grupo + load place + owner gate.
 *  3. Target NO puede ser owner del place → `target_is_owner`.
 *  4. Target debe ser miembro activo → `target_user_not_member`.
 *  5. INSERT GroupMembership con `addedByUserId` para audit.
 *  6. Catch P2002 → `already_in_group`.
 */
export async function addMemberToGroupAction(input: unknown): Promise<AddMemberToGroupResult> {
  const parsed = addMemberToGroupInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para asignar miembro a grupo.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const actorId = await requireAuthUserId(
    'Necesitás iniciar sesión para asignar miembros a grupos.',
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
    throw new AuthorizationError('Solo el owner puede asignar miembros a grupos.', {
      placeId: place.id,
      groupId: group.id,
      actorId,
    })
  }

  // Owner del place NO puede entrar a grupos (decisión #2 ADR — owner es
  // dios implícito; entrarlo a un grupo confunde el modelo).
  const targetIsOwner = await findPlaceOwnership(data.userId, place.id)
  if (targetIsOwner) {
    return { ok: false, error: 'target_is_owner' }
  }

  // Membership activa requerida.
  const targetMembership = await findActiveMembership(data.userId, place.id)
  if (!targetMembership) {
    return { ok: false, error: 'target_user_not_member' }
  }

  try {
    await prisma.groupMembership.create({
      data: {
        groupId: group.id,
        userId: data.userId,
        placeId: place.id,
        addedByUserId: actorId,
      },
      select: { id: true },
    })

    logger.info(
      {
        event: 'groupMembershipAdded',
        placeId: place.id,
        groupId: group.id,
        memberUserId: data.userId,
        actorId,
      },
      'group membership added',
    )

    revalidatePath(`/${place.slug}/settings/groups`)
    revalidatePath(`/${place.slug}/settings/groups/${group.id}`)
    revalidatePath(`/${place.slug}/settings/members/${data.userId}`)
    // Plan #2.3: agregar al preset cambia `isAdmin` del target. Para grupos
    // custom el findIsPlaceAdmin (preset-only) no cambia, pero por seguridad
    // y simetría con remove invalidamos siempre — el costo es nulo y el
    // riesgo de divergencia entre paths preset/custom desaparece.
    revalidateMemberPermissions(data.userId, place.id)
    return { ok: true }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, error: 'already_in_group' }
    }
    throw err
  }
}
