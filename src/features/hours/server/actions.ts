'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/db/client'
import { createSupabaseServer } from '@/shared/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { findMemberPermissions } from '@/features/members/public'
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

  const supabase = await createSupabaseServer()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) {
    throw new AuthorizationError('Necesitás iniciar sesión para editar el horario.')
  }
  const actorId = auth.user.id

  const place = await findPlaceStateBySlug(data.placeSlug)
  if (!place) {
    throw new NotFoundError('Place no encontrado.', { slug: data.placeSlug })
  }
  if (place.archivedAt) {
    throw new NotFoundError('El place está archivado.', { slug: data.placeSlug })
  }

  const perms = await findMemberPermissions(actorId, place.id)
  if (!perms.isOwner && perms.role !== 'ADMIN') {
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

  revalidatePath(`/${place.slug}`, 'layout')

  return { ok: true }
}
