'use server'

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/db/client'
import { logger } from '@/shared/lib/logger'
import { NotFoundError, OutOfHoursError, ValidationError } from '@/shared/errors/domain-error'
import { markPostReadInputSchema } from '@/features/discussions/schemas'
import {
  assertPostOpenForActivity,
  DWELL_THRESHOLD_MS,
} from '@/features/discussions/domain/invariants'
import { resolveActorForPlace } from '../actor'
import { findOrCreateCurrentOpening } from '../place-opening'

/**
 * Registra o actualiza un `PostRead` del viewer para este `(postId, placeOpeningId)`.
 * Invocado por el dwell tracker cliente tras 5s de visibilidad continua.
 *
 * Contrato (invariante 7, spec §8):
 * - UPSERT monótono: `readAt = now()` en cada fire, `dwellMs = GREATEST(existing, new)`.
 * - Re-leer el mismo post en la misma apertura actualiza `readAt` — necesario para
 *   que el dot ámbar se apague cuando llegó un comment nuevo post-primera-lectura.
 * - Atómico: `$queryRaw` con `INSERT ... ON CONFLICT DO UPDATE`. No try/catch P2002.
 * - `RETURNING (xmax = 0) AS inserted` distingue insert vs update para telemetría.
 *
 * Respuestas:
 * - Dwell `< DWELL_THRESHOLD_MS` ⇒ `ok:true, recorded:false`, skip (defensa por si
 *   el cliente manda un fire adelantado).
 * - Place sin apertura activa ⇒ `OutOfHoursError`. Cliente silencia.
 * - `recorded` = `true` si fue insert (primera lectura), `false` si fue update.
 *
 * Ver ADR `docs/decisions/2026-04-20-post-read-upsert-semantics.md` para el cambio
 * de semántica desde `DO NOTHING`.
 */
export async function markPostReadAction(input: unknown): Promise<{ ok: true; recorded: boolean }> {
  const parsed = markPostReadInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  const data = parsed.data

  if (data.dwellMs < DWELL_THRESHOLD_MS) {
    return { ok: true, recorded: false }
  }

  const post = await prisma.post.findUnique({
    where: { id: data.postId },
    select: { id: true, placeId: true, slug: true, hiddenAt: true },
  })
  if (!post) throw new NotFoundError('Post no encontrado.', { postId: data.postId })
  assertPostOpenForActivity(post)

  const actor = await resolveActorForPlace({ placeId: post.placeId })

  const opening = await findOrCreateCurrentOpening(post.placeId)
  if (!opening) {
    throw new OutOfHoursError(
      'El place está cerrado o sin horario; no se registran lecturas.',
      post.placeId,
      null,
    )
  }

  const id = randomUUID()
  const rows = await prisma.$queryRaw<Array<{ inserted: boolean }>>(Prisma.sql`
    INSERT INTO "PostRead" ("id", "postId", "userId", "placeOpeningId", "dwellMs", "readAt")
    VALUES (${id}, ${post.id}, ${actor.actorId}, ${opening.id}, ${data.dwellMs}, now())
    ON CONFLICT ("postId", "userId", "placeOpeningId")
    DO UPDATE SET
      "readAt"  = now(),
      "dwellMs" = GREATEST("PostRead"."dwellMs", EXCLUDED."dwellMs")
    RETURNING (xmax = 0) AS inserted
  `)
  const recorded = rows[0]?.inserted === true

  logger.info(
    {
      event: recorded ? 'postReadRecorded' : 'postReadUpdated',
      placeId: actor.placeId,
      postId: post.id,
      actorId: actor.actorId,
      placeOpeningId: opening.id,
      dwellMs: data.dwellMs,
    },
    recorded ? 'post read recorded' : 'post read updated (re-read in same opening)',
  )

  // Revalida el thread para que:
  // 1. El bloque `PostReadersBlock` refleje al nuevo lector (o el readAt actualizado
  //    en re-lecturas, que altera el orden `readAt DESC`).
  // 2. El dot indicator (`PostUnreadDot`) recompute `lastReadAt > lastActivityAt`
  //    en la próxima navegación del viewer.
  // Revalidate es idempotente — múltiples fires en ventana corta colapsan en un
  // solo refetch por cliente.
  revalidatePath(`/${actor.placeSlug}/conversations/${post.slug}`)

  return { ok: true, recorded }
}
