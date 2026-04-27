'use server'

import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { ValidationError } from '@/shared/errors/domain-error'
import { logger } from '@/shared/lib/logger'
import { assertPlaceOpenOrThrow } from '@/features/hours/public.server'
import { resolveActorForPlace } from '@/features/discussions/public.server'
import { createPostFromSystemHelper } from '@/features/discussions/public.server'
import {
  buildEventAuthorSnapshot,
  validateEventLocation,
  validateEventTimes,
  validateEventTimezone,
  validateEventTitle,
} from '@/features/events/domain/invariants'
import { assertRichTextSize } from '@/features/discussions/public'
import { createEventInputSchema } from '@/features/events/schemas'
import { buildEventThreadIntroBody } from '../thread-intro'
import { revalidateEventPaths } from './shared'

/**
 * Crea un evento + thread asociado en una **transacción atómica**.
 *
 * Flow:
 *  1. Parse Zod del input.
 *  2. Resuelve el actor (membership activa + admin/owner check).
 *  3. Gate: place debe estar abierto (defensa en profundidad — el `(gated)`
 *     layout ya invisibiliza, pero la action defiende contra calls directos).
 *  4. Valida invariants del dominio (título, fechas, timezone, location).
 *  5. Tx: insert Event con `postId: null` → `createPostFromSystemHelper`
 *     bajo el mismo tx → update Event con `postId = post.id`.
 *  6. Revalida rutas afectadas (lista, detalle, thread).
 *
 * Si el insert del Post falla por cualquier razón (RLS, slug collision tras
 * retry, validation), la tx rollbackea Event también. Atomicidad garantizada.
 *
 * Ver `docs/features/events/spec.md § 7` y `spec-integrations.md § 1`.
 */
export async function createEventAction(
  input: unknown,
): Promise<{ ok: true; eventId: string; postSlug: string }> {
  const parsed = createEventInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para crear evento.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const actor = await resolveActorForPlace({ placeId: data.placeId })
  await assertPlaceOpenOrThrow(actor.placeId)

  // Invariants del dominio (defensa en profundidad sobre Zod).
  validateEventTitle(data.title)
  validateEventTimes({ startsAt: data.startsAt, endsAt: data.endsAt ?? null }, new Date(), {
    requireFuture: true,
  })
  validateEventTimezone(data.timezone)
  validateEventLocation(data.location ?? null)
  if (data.description) assertRichTextSize(data.description)

  const trimmedTitle = data.title.trim()
  const authorSnapshot = buildEventAuthorSnapshot(actor.user)

  const result = await prisma.$transaction(async (tx) => {
    const event = await tx.event.create({
      data: {
        placeId: actor.placeId,
        authorUserId: actor.actorId,
        authorSnapshot: authorSnapshot as Prisma.InputJsonValue,
        title: trimmedTitle,
        description: data.description
          ? (data.description as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        startsAt: data.startsAt,
        endsAt: data.endsAt ?? null,
        timezone: data.timezone,
        location: data.location ?? null,
      },
      select: { id: true, title: true },
    })

    const post = await createPostFromSystemHelper(tx, {
      placeId: actor.placeId,
      // F.H.1 (2026-04-27): título auto-generado pasa de "Conversación: X"
      // a "🎉 X". Razón: el evento ES el thread (F.F); el prefijo
      // "Conversación:" era forzado y redundante. Slug derivado se
      // simplifica (emoji se strippea en `normalizeTitleToSlug`):
      // "🎉 Asado" → "asado".
      title: `🎉 ${event.title}`,
      body: buildEventThreadIntroBody({ id: event.id, title: event.title }),
      authorUserId: actor.actorId,
      authorSnapshot: authorSnapshot as Prisma.InputJsonValue,
      originSystem: 'event',
      originId: event.id,
    })

    await tx.event.update({
      where: { id: event.id },
      data: { postId: post.id },
    })

    return { eventId: event.id, postSlug: post.slug }
  })

  logger.info(
    {
      event: 'eventCreated',
      placeId: actor.placeId,
      eventId: result.eventId,
      postSlug: result.postSlug,
      actorId: actor.actorId,
    },
    'event created with auto-thread',
  )

  revalidateEventPaths(actor.placeSlug, result.eventId, result.postSlug)
  return { ok: true, ...result }
}
