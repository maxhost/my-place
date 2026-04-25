'use server'

import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { logger } from '@/shared/lib/logger'
import { assertPlaceOpenOrThrow } from '@/features/hours/public'
import { resolveActorForPlace } from '@/features/discussions/public.server'
import { assertRichTextSize } from '@/features/discussions/public'
import {
  validateEventLocation,
  validateEventTimes,
  validateEventTimezone,
  validateEventTitle,
} from '@/features/events/domain/invariants'
import { updateEventInputSchema } from '@/features/events/schemas'
import { revalidateEventPaths } from './shared'

/**
 * Actualiza un evento existente.
 *
 * Permisos: el autor o cualquier admin/owner del place pueden modificar.
 * `placeId` es inmutable (no se puede transferir un evento entre places).
 * El Post asociado **NO** se actualiza automáticamente (decisión § 6 spec) —
 * cambiar el title del Post post-hoc rompería la conversación ya iniciada.
 *
 * Permitimos `startsAt <= now` en update (corregir typo de descripción
 * mientras el evento pasa). Sigue validando `endsAt > startsAt` y duración
 * ≤ 7 días.
 *
 * Cancelar un evento NO se hace acá — `cancelEventAction` setea
 * `cancelledAt` exclusivamente para preservar el invariant.
 *
 * Ver `docs/features/events/spec.md § 7`.
 */
export async function updateEventAction(input: unknown): Promise<{ ok: true }> {
  const parsed = updateEventInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para actualizar evento.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const event = await prisma.event.findUnique({
    where: { id: data.eventId },
    select: { id: true, placeId: true, authorUserId: true, postId: true, cancelledAt: true },
  })
  if (!event) {
    throw new NotFoundError('Evento no encontrado.', { eventId: data.eventId })
  }

  const actor = await resolveActorForPlace({ placeId: event.placeId })
  await assertPlaceOpenOrThrow(actor.placeId)

  if (event.authorUserId !== actor.actorId && !actor.isAdmin) {
    throw new AuthorizationError('Solo el autor o admin pueden modificar este evento.', {
      eventId: event.id,
      actorId: actor.actorId,
    })
  }

  validateEventTitle(data.title)
  validateEventTimes({ startsAt: data.startsAt, endsAt: data.endsAt ?? null }, new Date(), {
    requireFuture: false,
  })
  validateEventTimezone(data.timezone)
  validateEventLocation(data.location ?? null)
  if (data.description) assertRichTextSize(data.description)

  await prisma.event.update({
    where: { id: event.id },
    data: {
      title: data.title.trim(),
      description: data.description ? (data.description as Prisma.InputJsonValue) : Prisma.JsonNull,
      startsAt: data.startsAt,
      endsAt: data.endsAt ?? null,
      timezone: data.timezone,
      location: data.location ?? null,
    },
  })

  logger.info(
    {
      event: 'eventUpdated',
      placeId: actor.placeId,
      eventId: event.id,
      actorId: actor.actorId,
      byAdmin: event.authorUserId !== actor.actorId,
    },
    'event updated',
  )

  revalidateEventPaths(actor.placeSlug, event.id)
  return { ok: true }
}
