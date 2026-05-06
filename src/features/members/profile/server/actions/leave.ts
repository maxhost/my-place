'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/db/client'
import { logger } from '@/shared/lib/logger'
import { InvariantViolation, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { requireAuthUserId } from '@/shared/lib/auth-user'
import { assertPlaceActive } from '@/features/members/domain/invariants'
import { leaveMembershipPlaceSlugSchema } from '@/features/members/schemas'
import { findActiveMembership, findPlaceStateBySlug } from '@/features/members/server/queries'
import { revalidateMemberPermissions } from '@/features/members/public.server'

/**
 * Sale del place: setea `Membership.leftAt = now()`. Si el actor era owner, también
 * remueve su `PlaceOwnership`. Si era **el único** owner, falla con `InvariantViolation`
 * — debe transferir ownership antes.
 *
 * Concurrencia: usa `SELECT ... FOR UPDATE` sobre `PlaceOwnership` del place dentro de
 * la tx, así dos owners que hacen leave simultáneo se serializan y el segundo falla.
 * Ver `docs/features/members/spec.md` § "Salir".
 */
export async function leaveMembershipAction(
  placeSlug: unknown,
): Promise<{ ok: true; placeSlug: string }> {
  const parsed = leaveMembershipPlaceSlugSchema.safeParse(placeSlug)
  if (!parsed.success) {
    throw new ValidationError('Slug del place inválido.', { issues: parsed.error.issues })
  }
  const slug = parsed.data
  const actorId = await requireAuthUserId('Necesitás iniciar sesión para salir de un place.')

  const place = await findPlaceStateBySlug(slug)
  if (!place) throw new NotFoundError('Place no encontrado.', { slug })
  assertPlaceActive(place)

  const membership = await findActiveMembership(actorId, place.id)
  if (!membership) {
    throw new NotFoundError('No sos miembro activo de este place.', {
      placeId: place.id,
      actorId,
    })
  }

  await performMembershipLeaveTx(actorId, place.id, membership.id)

  logger.info({ event: 'memberLeft', placeId: place.id, actorId }, 'member left place')
  revalidatePath('/inbox')
  revalidatePath(`/${place.slug}`)
  // El layout RSC de `[placeSlug]` computa `isAdmin` con findMemberPermissions.
  // Al salir, los perms del actor desaparecen — invalidamos el subtree del layout
  // para que TopBar trigger / settings nav dejen de aparecer en tabs cacheados.
  revalidatePath(`/${place.slug}`, 'layout')
  // Plan #2.3: invalidar el cache cross-request de findMemberPermissions.
  revalidateMemberPermissions(actorId, place.id)
  return { ok: true, placeSlug: place.slug }
}

/**
 * Tx del leave: lock pesimista sobre `PlaceOwnership` del place, chequeo de
 * único-owner, eventual delete de ownership, y update `leftAt` del membership.
 * El caller provee `membershipId` ya resuelto para que el helper sea puro
 * sobre IDs.
 */
async function performMembershipLeaveTx(
  actorId: string,
  placeId: string,
  membershipId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Lock de fila pesimista sobre TODAS las ownerships del place. Serializa owners
    // concurrentes: si dos owners ejecutan leave al mismo tiempo, el segundo espera
    // y lee el estado ya modificado por el primero — uno gana, el otro falla.
    await tx.$queryRaw`SELECT id FROM "PlaceOwnership" WHERE "placeId" = ${placeId} FOR UPDATE`

    const ownerships = await tx.placeOwnership.findMany({
      where: { placeId },
      select: { userId: true },
    })
    const actorIsOwner = ownerships.some((o) => o.userId === actorId)

    if (actorIsOwner && ownerships.length === 1) {
      throw new InvariantViolation('Sos el único owner. Transferí la ownership antes de salir.', {
        reason: 'last_owner',
        placeId,
        actorId,
      })
    }

    if (actorIsOwner) {
      await tx.placeOwnership.delete({
        where: { userId_placeId: { userId: actorId, placeId } },
      })
    }

    await tx.membership.update({
      where: { id: membershipId },
      data: { leftAt: new Date() },
    })
  })
}
