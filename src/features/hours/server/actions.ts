'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/db/client'
import { requireAuthUserId } from '@/shared/lib/auth-user'
import { logger } from '@/shared/lib/logger'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { findMemberPermissions } from '@/features/members/public.server'
import { revalidatePlaceCache } from '@/features/places/public.server'
import { updateHoursInputSchema } from '../schemas'
import { findPlaceStateBySlug } from './queries'

/**
 * Actualiza el horario del place. Solo admin/owner.
 *
 * - Input completo: timezone + recurring + exceptions. Reemplaza atómicamente el
 *   JSON previo — no es un merge incremental. La UI reenvía el estado entero.
 * - Un input con `recurring: []` y `exceptions: []` equivale a "cerrado con
 *   timezone elegido" (todavía `scheduled`, no `unconfigured`). Dejar volver a
 *   `unconfigured` se hace por SQL; no es un caso de UI.
 *
 * Ver `docs/features/hours/spec.md` § "Flows principales".
 */
export async function updatePlaceHoursAction(input: unknown): Promise<{ ok: true }> {
  const parsed = updateHoursInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Horario inválido.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const actorId = await requireAuthUserId('Necesitás iniciar sesión para editar el horario.')

  const place = await findPlaceStateBySlug(data.placeSlug)
  if (!place) {
    throw new NotFoundError('Place no encontrado.', { slug: data.placeSlug })
  }
  if (place.archivedAt) {
    throw new NotFoundError('El place está archivado.', { slug: data.placeSlug })
  }

  const perms = await findMemberPermissions(actorId, place.id)
  if (!perms.isAdmin) {
    throw new AuthorizationError('Solo admins y owners pueden editar el horario.', {
      placeId: place.id,
      actorId,
    })
  }

  const openingHours = {
    kind: 'scheduled' as const,
    timezone: data.timezone,
    recurring: data.recurring,
    exceptions: data.exceptions,
  }

  await prisma.place.update({
    where: { id: place.id },
    data: { openingHours },
  })

  logger.info(
    {
      event: 'placeHoursUpdated',
      placeId: place.id,
      actorId,
      timezone: data.timezone,
      recurringCount: data.recurring.length,
      exceptionsCount: data.exceptions.length,
    },
    'place hours updated',
  )

  // Antes hacíamos `revalidatePath(/${slug}, 'layout')` que invalidaba TODA
  // la subtree del place (~25 routes) por un cambio que sólo afecta
  // `place.openingHours`. Ahora invalidamos por tag granular + path puntual:
  //
  //  - `revalidatePlaceCache(slug, id)` (Sesión 5.1): tira los buckets
  //    `place:slug:${slug}` y `place:id:${id}` que envuelven
  //    `loadPlaceBySlug`/`loadPlaceById` con `unstable_cache`. El campo
  //    `openingHours` viaja en el shape cacheado, así que cualquier page
  //    bajo `/${slug}/...` levanta los datos nuevos en el próximo request.
  //  - `revalidatePath('/${slug}/settings/hours')`: la página del editor
  //    re-renderiza con el JSON nuevo después del save.
  //
  // No invalidamos `/${slug}/events` ni el resto del subtree: las páginas
  // del place leen `openingHours` vía `loadPlaceBySlug`, así que el tag
  // alcanza para que vean el nuevo horario.
  revalidatePlaceCache(place.slug, place.id)
  revalidatePath(`/${place.slug}/settings/hours`)

  return { ok: true }
}
