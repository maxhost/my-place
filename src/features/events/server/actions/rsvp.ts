'use server'

import { prisma } from '@/db/client'
import { ConflictError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { logger } from '@/shared/lib/logger'
import { resolveActorForPlace } from '@/features/discussions/public.server'
import { normalizeRsvpNote, validateRsvpNote } from '@/features/events/domain/invariants'
import { rsvpEventInputSchema } from '@/features/events/schemas'
import { revalidateEventPaths } from './shared'

/**
 * Upsert idempotente de la RSVP del actor sobre un evento.
 *
 * Comportamiento:
 *  - INSERT si el actor no tiene RSVP previa.
 *  - UPDATE si ya existe (cambia `state` y `note` simultáneamente).
 *  - `note` se normaliza: descartado si el estado es `GOING`/`NOT_GOING`
 *    (defensa adicional al CHECK constraint en DB).
 *
 * Validaciones:
 *  - El evento existe y NO está cancelado (no se puede RSVPear post-cancel).
 *  - `note` sólo permitido en `GOING_CONDITIONAL`/`NOT_GOING_CONTRIBUTING`.
 *
 * Permisos: cualquier miembro activo. RLS enforce que el actor no RSVPee en
 * nombre de otro user (`userId = auth.uid()`).
 *
 * Ver `docs/features/events/spec-rsvp.md § 3`.
 */
export async function rsvpEventAction(input: unknown): Promise<{ ok: true }> {
  const parsed = rsvpEventInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para RSVP.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const event = await prisma.event.findUnique({
    where: { id: data.eventId },
    select: { id: true, placeId: true, cancelledAt: true },
  })
  if (!event) {
    throw new NotFoundError('Evento no encontrado.', { eventId: data.eventId })
  }
  if (event.cancelledAt) {
    throw new ConflictError('No se puede RSVPear en un evento cancelado.', {
      eventId: event.id,
    })
  }

  const actor = await resolveActorForPlace({ placeId: event.placeId })

  // Invariants del dominio + normalización del note.
  validateRsvpNote(data.state, data.note ?? null)
  const normalizedNote = normalizeRsvpNote(data.state, data.note ?? null)

  await prisma.eventRSVP.upsert({
    where: { eventId_userId: { eventId: event.id, userId: actor.actorId } },
    create: {
      eventId: event.id,
      userId: actor.actorId,
      state: data.state,
      note: normalizedNote,
    },
    update: {
      state: data.state,
      note: normalizedNote,
    },
  })

  logger.info(
    {
      event: 'rsvpUpserted',
      placeId: actor.placeId,
      eventId: event.id,
      actorId: actor.actorId,
      state: data.state,
      hasNote: normalizedNote != null,
    },
    'rsvp upserted',
  )

  revalidateEventPaths(actor.placeSlug, event.id)
  return { ok: true }
}
