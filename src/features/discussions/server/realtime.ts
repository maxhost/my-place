import 'server-only'
import { getBroadcastSender } from '@/shared/lib/realtime/server'
import { serverEnv } from '@/shared/config/env'
import { logger } from '@/shared/lib/logger'
import type { CommentView } from './queries'

/**
 * Semantic layer sobre `shared/lib/realtime` para el slice `discussions`.
 *
 * Convención de topic: `post:<postId>`. Simetría con las policies
 * `realtime.messages` definidas en la migration
 * `20260424000000_realtime_discussions_presence`.
 *
 * Postura: **best-effort**. Este helper traga los errores del sender — la
 * visibilidad autoritaria del comment viene de `revalidatePath` en el
 * action, no de este broadcast. Si el broadcast falla, el user verá el
 * comment al próximo refresh SSR.
 *
 * Feature flag `DISCUSSIONS_BROADCAST_ENABLED`: rollback rápido a
 * comportamiento pre-implementación. Por default ON. Setear a `'false'`
 * (string) en env desactiva la emisión sin deploy de código.
 */

export type NewCommentBroadcastPayload = {
  comment: CommentView
}

const BROADCAST_EVENT = 'comment_created'

export async function broadcastNewComment(
  postId: string,
  payload: NewCommentBroadcastPayload,
): Promise<void> {
  if (!isBroadcastEnabled()) {
    logger.debug(
      { event: 'commentBroadcastDisabled', postId, commentId: payload.comment.id },
      'broadcast skipped: feature flag off',
    )
    return
  }
  const topic = `post:${postId}`
  try {
    await getBroadcastSender().send(topic, BROADCAST_EVENT, {
      comment: payload.comment,
    })
    logger.debug(
      {
        event: 'commentBroadcastEmitted',
        postId,
        commentId: payload.comment.id,
      },
      'comment broadcast emitted',
    )
  } catch (err) {
    logger.warn(
      {
        event: 'commentBroadcastFailed',
        postId,
        commentId: payload.comment.id,
        err: err instanceof Error ? { message: err.message, name: err.name } : err,
      },
      'comment broadcast failed',
    )
  }
}

/**
 * Flag de rollback. Opt-out explícito con `'false'`. Cualquier otro valor
 * (incluido undefined) deja el broadcast habilitado — default ON es
 * deliberado (ver ADR `2026-04-21-shared-realtime-module.md`). Validado
 * por Zod en `shared/config/env.ts` (enum `'true' | 'false' | undefined`).
 */
function isBroadcastEnabled(): boolean {
  return serverEnv.DISCUSSIONS_BROADCAST_ENABLED !== 'false'
}
