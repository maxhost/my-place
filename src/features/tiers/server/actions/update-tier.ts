'use server'

import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { requireAuthUserId } from '@/shared/lib/auth-user'
import { findPlaceOwnership } from '@/shared/lib/identity-cache'
import { loadPlaceById } from '@/shared/lib/place-loader'
import { logger } from '@/shared/lib/logger'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import {
  validateTierDescription,
  validateTierName,
  validateTierPriceCents,
} from '@/features/tiers/domain/invariants'
import { updateTierInputSchema } from '@/features/tiers/schemas'
import { revalidateTiersCache } from '../cache'
import { revalidateTiersPaths } from './shared'

/** `name_already_published`: colisión con otro tier PUBLISHED (case-insensitive)
 *  del mismo place. Partial unique index `Tier_placeId_lowerName_published_unique`
 *  garantiza a nivel DB; el check pre-update es UX. */
export type UpdateTierResult = { ok: true } | { ok: false; error: 'name_already_published' }

/** Owner-only. NO cambia visibility (eso es `setTierVisibilityAction`).
 *  v2 (TierMembership): priceCents/currency/duration inmutables post-publish.
 *  Spec § 10 + ADR decisiones #10-11. */
export async function updateTierAction(input: unknown): Promise<UpdateTierResult> {
  const parsed = updateTierInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para editar tier.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const actorId = await requireAuthUserId('Necesitás iniciar sesión para editar tiers.')

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
    throw new AuthorizationError('Solo el owner puede editar tiers.', {
      placeId: place.id,
      tierId: tier.id,
      actorId,
    })
  }

  validateTierName(data.name)
  validateTierDescription(data.description ?? null)
  validateTierPriceCents(data.priceCents)

  const trimmedName = data.name.trim()
  const trimmedDescription = data.description?.trim() ?? null
  const nameChanged = trimmedName.toLowerCase() !== tier.name.toLowerCase()

  // Pre-check del partial unique: sólo aplica si el tier está PUBLISHED y
  // el name cambia (case-insensitive). Si está HIDDEN, el index no aplica.
  if (tier.visibility === 'PUBLISHED' && nameChanged) {
    const collision = await prisma.tier.findFirst({
      where: {
        placeId: place.id,
        visibility: 'PUBLISHED',
        name: { equals: trimmedName, mode: 'insensitive' },
        NOT: { id: tier.id },
      },
      select: { id: true },
    })
    if (collision) {
      logger.info(
        {
          event: 'tierUpdateRejected',
          reason: 'name_already_published',
          placeId: place.id,
          tierId: tier.id,
          name: trimmedName,
          actorId,
        },
        'tier update rejected — another PUBLISHED tier already uses this name',
      )
      return { ok: false, error: 'name_already_published' }
    }
  }

  try {
    await prisma.tier.update({
      where: { id: tier.id },
      data: {
        name: trimmedName,
        description:
          trimmedDescription && trimmedDescription.length > 0 ? trimmedDescription : null,
        priceCents: data.priceCents,
        currency: data.currency,
        duration: data.duration,
      },
    })
  } catch (err) {
    // P2002 = unique constraint violation. Acá sólo puede venir del
    // partial unique `Tier_placeId_lowerName_published_unique` (race
    // entre nuestro pre-check y el UPDATE). Mismo error friendly.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.warn(
        {
          event: 'tierUpdateConflict',
          reason: 'name_already_published_race',
          placeId: place.id,
          tierId: tier.id,
          name: trimmedName,
          actorId,
        },
        'tier update lost a race against a concurrent publish — name collision',
      )
      return { ok: false, error: 'name_already_published' }
    }
    throw err
  }

  logger.info(
    {
      event: 'tierUpdated',
      placeId: place.id,
      tierId: tier.id,
      priceCents: data.priceCents,
      duration: data.duration,
      actorId,
    },
    'tier updated',
  )

  revalidateTiersPaths(place.slug)
  revalidateTiersCache(place.id)
  return { ok: true }
}
