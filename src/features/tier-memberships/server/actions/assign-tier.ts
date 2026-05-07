'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/db/client'
import { requireAuthUserId } from '@/shared/lib/auth-user'
import {
  findActiveMembership,
  findPlaceOwnership,
  findUserProfile,
} from '@/shared/lib/identity-cache'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { logger } from '@/shared/lib/logger'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { computeExpiresAt } from '@/features/tier-memberships/domain/expiration'
import { isActiveMembership, isTierAssignable } from '@/features/tier-memberships/domain/invariants'
import { buildAssignedBySnapshot } from '@/features/tier-memberships/domain/snapshot'
import { assignTierInputSchema } from '@/features/tier-memberships/schemas'
import { revalidateTierAssignmentsCache } from '@/features/tier-memberships/server/cache'

/**
 * Resultado de `assignTierToMemberAction` — discriminated union.
 *
 * Errores **esperados** del flujo viajan acá (gotcha CLAUDE.md 2026-05-02:
 * Next 15 NO preserva `code`/`context` en throws desde Server Actions).
 *
 * - `tier_not_published`: el tier objetivo no está PUBLISHED. UI ya filtra
 *   el dropdown a PUBLISHED, este error es defense in depth contra payloads
 *   manipulados.
 * - `tier_already_assigned`: el `(tierId, userId)` ya existe — viola el
 *   `@@unique([tierId, userId])`. Catch P2002 cubre el race con asignación
 *   concurrente.
 * - `target_user_not_member`: el `memberUserId` no es miembro activo del
 *   place (sin row de Membership o `leftAt !== null`).
 *
 * Errores **inesperados** (auth, place no encontrado, validación rota)
 * siguen como throw → caen al `error.tsx` boundary.
 */
export type AssignTierResult =
  | { ok: true; tierMembershipId: string }
  | {
      ok: false
      error: 'tier_not_published' | 'tier_already_assigned' | 'target_user_not_member'
    }

/**
 * Asigna un tier a un miembro del place. Owner-only.
 *
 * Flow:
 *  1. Parse Zod del input.
 *  2. Auth: `requireAuthUserId` (sesión obligatoria).
 *  3. Resuelve el place por slug — `NotFoundError` si no existe o está
 *     archivado.
 *  4. Owner gate: `findPlaceOwnership(actor, placeId)` — `AuthorizationError`
 *     si el actor no es owner. Admin no califica (decisión #1 ADR Tiers).
 *  5. Carga el tier por id (defense in depth) y el target Membership.
 *  6. Discriminated union checks: tier no encontrado → NotFoundError;
 *     target no es miembro activo → `target_user_not_member`; tier no
 *     PUBLISHED → `tier_not_published`.
 *  7. Calcula `expiresAt` con `computeExpiresAt(assignedAt, tier.duration,
 *     indefinite)`.
 *  8. Carga snapshot del assigner via `findUserProfile`.
 *  9. INSERT del TierMembership. Catch P2002 → `tier_already_assigned`
 *     (race con asignación concurrente).
 *  10. Log + revalida `/${placeSlug}/settings/members/${memberUserId}`.
 *
 * Ver `docs/features/tier-memberships/spec.md` § 10.
 */
export async function assignTierToMemberAction(input: unknown): Promise<AssignTierResult> {
  const parsed = assignTierInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para asignar tier.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const actorId = await requireAuthUserId('Necesitás iniciar sesión para asignar tiers.')

  const place = await loadPlaceBySlug(data.placeSlug)
  if (!place || place.archivedAt) {
    throw new NotFoundError('Place no encontrado.', { placeSlug: data.placeSlug })
  }

  const isOwner = await findPlaceOwnership(actorId, place.id)
  if (!isOwner) {
    throw new AuthorizationError('Solo el owner puede asignar tiers.', {
      placeId: place.id,
      actorId,
    })
  }

  const tier = await prisma.tier.findUnique({
    where: { id: data.tierId },
    select: { id: true, placeId: true, duration: true, visibility: true },
  })
  if (!tier || tier.placeId !== place.id) {
    throw new NotFoundError('Tier no encontrado.', {
      tierId: data.tierId,
      placeId: place.id,
    })
  }

  // Target membership: required activo. `findActiveMembership` ya filtra
  // por `leftAt: null` — un null retorno significa "no es miembro activo".
  // El wrapper `isActiveMembership` permite el doble shape (row crudo con
  // `leftAt` o el resultado pre-filtrado).
  const targetMembership = await findActiveMembership(data.memberUserId, place.id)
  if (!isActiveMembership(targetMembership)) {
    return { ok: false, error: 'target_user_not_member' }
  }

  if (!isTierAssignable(tier.visibility)) {
    return { ok: false, error: 'tier_not_published' }
  }

  const assignedAt = new Date()
  const expiresAt = computeExpiresAt(assignedAt, tier.duration, data.indefinite)

  const assignerProfile = await findUserProfile(actorId)
  if (!assignerProfile) {
    // Edge case: el actor pasó auth pero su row de User no existe (race con
    // erasure?). NotFound antes que silenciar — el owner debería re-loguear.
    throw new NotFoundError('Usuario asignador no encontrado.', { actorId })
  }
  const assignedBySnapshot = buildAssignedBySnapshot(assignerProfile)

  try {
    const created = await prisma.tierMembership.create({
      data: {
        tierId: tier.id,
        userId: data.memberUserId,
        placeId: place.id,
        assignedAt,
        assignedByUserId: actorId,
        assignedBySnapshot,
        expiresAt,
      },
      select: { id: true },
    })

    logger.info(
      {
        event: 'tierMembershipAssigned',
        placeId: place.id,
        tierId: tier.id,
        memberUserId: data.memberUserId,
        tierMembershipId: created.id,
        indefinite: data.indefinite,
        expiresAt: expiresAt?.toISOString() ?? null,
        actorId,
      },
      'tier membership assigned',
    )

    revalidatePath(`/${place.slug}/settings/members/${data.memberUserId}`)
    revalidateTierAssignmentsCache(place.id, data.memberUserId)
    return { ok: true, tierMembershipId: created.id }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.info(
        {
          event: 'tierMembershipAssignRejected',
          reason: 'tier_already_assigned',
          placeId: place.id,
          tierId: tier.id,
          memberUserId: data.memberUserId,
          actorId,
        },
        'tier assignment rejected — already assigned',
      )
      return { ok: false, error: 'tier_already_assigned' }
    }
    throw err
  }
}
