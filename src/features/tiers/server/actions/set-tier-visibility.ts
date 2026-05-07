'use server'

import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { requireAuthUserId } from '@/shared/lib/auth-user'
import { findPlaceOwnership } from '@/shared/lib/identity-cache'
import { loadPlaceById } from '@/shared/lib/place-loader'
import { logger } from '@/shared/lib/logger'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { setTierVisibilityInputSchema } from '@/features/tiers/schemas'
import type { TierVisibility } from '@/features/tiers/domain/types'
import { revalidateTiersCache } from '../cache'
import { revalidateTiersPaths } from './shared'

/** `name_already_published`: target=PUBLISHED + colisión con otro
 *  PUBLISHED case-insensitive. Partial unique index garantiza en DB. */
export type SetTierVisibilityResult =
  | { ok: true; visibility: TierVisibility; changed: boolean }
  | { ok: false; error: 'name_already_published' }

/** Owner-only toggle PUBLISHED↔HIDDEN. Idempotente.
 *  Invariante: máx 1 PUBLISHED por (placeId, name) lower-case.
 *  Spec § 10. */
export async function setTierVisibilityAction(input: unknown): Promise<SetTierVisibilityResult> {
  const parsed = setTierVisibilityInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para cambiar visibilidad.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data
  const targetVisibility = data.visibility as TierVisibility

  const actorId = await requireAuthUserId(
    'Necesitás iniciar sesión para cambiar la visibilidad de un tier.',
  )

  const tier = await prisma.tier.findUnique({
    where: { id: data.tierId },
    select: { id: true, placeId: true, name: true, visibility: true },
  })
  if (!tier) {
    throw new NotFoundError('Tier no encontrado.', { tierId: data.tierId })
  }

  const place = await loadPlaceById(tier.placeId)
  if (!place || place.archivedAt) {
    throw new NotFoundError('Place no encontrado.', { placeId: tier.placeId })
  }

  const isOwner = await findPlaceOwnership(actorId, place.id)
  if (!isOwner) {
    throw new AuthorizationError('Solo el owner puede cambiar la visibilidad.', {
      placeId: place.id,
      tierId: tier.id,
      actorId,
    })
  }

  if (tier.visibility === targetVisibility) {
    return { ok: true, visibility: targetVisibility, changed: false }
  }

  // Pre-check del partial unique sólo aplica al transicionar a PUBLISHED.
  // HIDDEN → PUBLISHED: chequear que no haya OTRO tier PUBLISHED con
  // mismo name lower-case. PUBLISHED → HIDDEN: nunca colisiona.
  if (targetVisibility === 'PUBLISHED') {
    const collision = await prisma.tier.findFirst({
      where: {
        placeId: place.id,
        visibility: 'PUBLISHED',
        name: { equals: tier.name, mode: 'insensitive' },
        NOT: { id: tier.id },
      },
      select: { id: true },
    })
    if (collision) {
      logger.info(
        {
          event: 'tierVisibilityRejected',
          reason: 'name_already_published',
          placeId: place.id,
          tierId: tier.id,
          name: tier.name,
          actorId,
        },
        'tier publish rejected — another PUBLISHED tier with same name',
      )
      return { ok: false, error: 'name_already_published' }
    }
  }

  try {
    await prisma.tier.update({
      where: { id: tier.id },
      data: { visibility: targetVisibility },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.warn(
        {
          event: 'tierVisibilityConflict',
          reason: 'name_already_published_race',
          placeId: place.id,
          tierId: tier.id,
          name: tier.name,
          actorId,
        },
        'tier publish lost a race against a concurrent publish — name collision',
      )
      return { ok: false, error: 'name_already_published' }
    }
    throw err
  }

  logger.info(
    {
      event: 'tierVisibilityChanged',
      placeId: place.id,
      tierId: tier.id,
      from: tier.visibility,
      to: targetVisibility,
      actorId,
    },
    'tier visibility changed',
  )

  revalidateTiersPaths(place.slug)
  revalidateTiersCache(place.id)
  return { ok: true, visibility: targetVisibility, changed: true }
}
