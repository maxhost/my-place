'use server'

import { prisma } from '@/db/client'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'
import { logger } from '@/shared/lib/logger'
import { resolveActorForPlace } from '@/features/discussions/public.server'
import { cancelEventInputSchema } from '@/features/events/schemas'
import { revalidateEventPaths } from './shared'

/**
 * Cancela un evento (soft-cancel: setea `cancelledAt`, NO borra).
 *
 * Permisos: autor o admin/owner del place. Idempotente — cancelar un evento
 * ya cancelado no falla, simplemente conserva el `cancelledAt` original.
 *
 * Comportamiento:
 *  - El Post asociado **sigue vivo** (la conversación continúa). UI muestra
 *    badge "Cancelado" leyendo `event.cancelledAt`.
 *  - RSVPs se preservan tal cual — señal histórica. RLS bloquea INSERT de
 *    nuevas RSVPs en evento cancelado.
 *  - Cancelar un evento ya pasado se permite (admin retroactivo); no es
 *    útil pero no es prohibido.
 *
 * Ver `docs/features/events/spec.md § 7`.
 */
export async function cancelEventAction(input: unknown): Promise<{ ok: true }> {
  const parsed = cancelEventInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para cancelar evento.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const event = await prisma.event.findUnique({
    where: { id: data.eventId },
    select: { id: true, placeId: true, authorUserId: true, cancelledAt: true },
  })
  if (!event) {
    throw new NotFoundError('Evento no encontrado.', { eventId: data.eventId })
  }

  const actor = await resolveActorForPlace({ placeId: event.placeId })
  if (event.authorUserId !== actor.actorId && !actor.isAdmin) {
    throw new AuthorizationError('Solo el autor o admin pueden cancelar este evento.', {
      eventId: event.id,
      actorId: actor.actorId,
    })
  }

  if (event.cancelledAt) {
    // Idempotencia explícita: no fallar, no relog spam. Devolvemos ok.
    throw new ConflictError('El evento ya estaba cancelado.', {
      eventId: event.id,
      cancelledAt: event.cancelledAt.toISOString(),
    })
  }

  const now = new Date()
  await prisma.event.update({
    where: { id: event.id },
    data: { cancelledAt: now },
  })

  logger.info(
    {
      event: 'eventCancelled',
      placeId: actor.placeId,
      eventId: event.id,
      actorId: actor.actorId,
      byAdmin: event.authorUserId !== actor.actorId,
    },
    'event cancelled',
  )

  revalidateEventPaths(actor.placeSlug, event.id)
  return { ok: true }
}
