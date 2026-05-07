'use server'

import { prisma } from '@/db/client'
import { requireAuthUserId } from '@/shared/lib/auth-user'
import { findPlaceOwnership } from '@/shared/lib/identity-cache'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { logger } from '@/shared/lib/logger'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import {
  validateTierDescription,
  validateTierName,
  validateTierPriceCents,
} from '@/features/tiers/domain/invariants'
import { createTierInputSchema } from '@/features/tiers/schemas'
import { revalidateTiersCache } from '../cache'
import { revalidateTiersPaths } from './shared'

/**
 * Crea un tier en un place. Owner-only.
 *
 * Sin dedup global de nombre: la decisión #11 ADR (actualizada
 * 2026-05-02) permite N tiers con el mismo nombre case-insensitive
 * dentro del mismo place. La invariante real ("máx 1 PUBLISHED por
 * (placeId, name) lower-case") la enforce el partial unique index
 * `Tier_placeId_lowerName_published_unique` (migration
 * 20260502010000) y se chequea en `setTierVisibilityAction` /
 * `updateTierAction`.
 *
 * Como los tiers nuevos arrancan en `visibility = HIDDEN` (default
 * del schema), `createTierAction` NUNCA puede violar el partial
 * unique index. Por eso no necesita catch de P2002 ni discriminated
 * union — el create siempre es exitoso si pasa las invariantes
 * básicas + auth + ownership.
 *
 * Flow:
 *  1. Parse Zod del input.
 *  2. Auth: `requireAuthUserId` (sesión obligatoria).
 *  3. Resuelve el place por slug — `NotFoundError` si no existe o está
 *     archivado.
 *  4. Owner gate: `findPlaceOwnership(actor, placeId)` — `AuthorizationError`
 *     si el actor no es owner. Admin no califica (decisión #1 ADR).
 *  5. Invariants del dominio (defensa en profundidad sobre Zod).
 *  6. INSERT con `visibility = HIDDEN` por default.
 *  7. Revalida `/${placeSlug}/settings/tiers`.
 *
 * Ver `docs/features/tiers/spec.md` § 10.
 */
export async function createTierAction(input: unknown): Promise<{ ok: true; tierId: string }> {
  const parsed = createTierInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para crear tier.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const actorId = await requireAuthUserId('Necesitás iniciar sesión para crear tiers.')

  const place = await loadPlaceBySlug(data.placeSlug)
  if (!place || place.archivedAt) {
    throw new NotFoundError('Place no encontrado.', { placeSlug: data.placeSlug })
  }

  const isOwner = await findPlaceOwnership(actorId, place.id)
  if (!isOwner) {
    throw new AuthorizationError('Solo el owner puede crear tiers.', {
      placeId: place.id,
      actorId,
    })
  }

  // Defensa en profundidad de Zod.
  validateTierName(data.name)
  validateTierDescription(data.description ?? null)
  validateTierPriceCents(data.priceCents)

  const trimmedName = data.name.trim()
  const trimmedDescription = data.description?.trim() ?? null

  const created = await prisma.tier.create({
    data: {
      placeId: place.id,
      name: trimmedName,
      description: trimmedDescription && trimmedDescription.length > 0 ? trimmedDescription : null,
      priceCents: data.priceCents,
      currency: data.currency,
      duration: data.duration,
      // visibility default HIDDEN (schema default; explícito sería redundante)
    },
    select: { id: true },
  })

  logger.info(
    {
      event: 'tierCreated',
      placeId: place.id,
      tierId: created.id,
      priceCents: data.priceCents,
      duration: data.duration,
      actorId,
    },
    'tier created',
  )

  revalidateTiersPaths(place.slug)
  revalidateTiersCache(place.id)
  return { ok: true, tierId: created.id }
}
