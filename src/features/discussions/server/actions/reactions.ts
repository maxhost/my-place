'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { assertPlaceOpenOrThrow } from '@/features/hours/public'
import { logger } from '@/shared/lib/logger'
import { NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { reactInputSchema, unreactInputSchema } from '@/features/discussions/schemas'
import {
  assertCommentAlive,
  assertPostOpenForActivity,
} from '@/features/discussions/domain/invariants'
import { resolveActorForPlace } from '../actor'

/**
 * Agrega una reacción a un Post o Comment. UNIQUE `(target, user, emoji)` hace
 * la operación idempotente: una segunda llamada con el mismo emoji retorna
 * `alreadyReacted: true` sin duplicar fila.
 */
export async function reactAction(input: unknown): Promise<{ ok: true; alreadyReacted: boolean }> {
  const parsed = reactInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  const data = parsed.data

  const target = await resolveReactableTarget(data.targetType, data.targetId)
  const actor = await resolveActorForPlace({ placeId: target.placeId })
  await assertPlaceOpenOrThrow(actor.placeId)

  let alreadyReacted = false
  try {
    await prisma.reaction.create({
      data: {
        targetType: data.targetType,
        targetId: data.targetId,
        placeId: target.placeId,
        userId: actor.actorId,
        emoji: data.emoji,
      },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      alreadyReacted = true
    } else {
      throw err
    }
  }

  logger.info(
    {
      event: 'reactionAdded',
      placeId: actor.placeId,
      targetType: data.targetType,
      targetId: data.targetId,
      emoji: data.emoji,
      actorId: actor.actorId,
      alreadyReacted,
    },
    'reaction added',
  )

  revalidatePath(`/${actor.placeSlug}/conversations/${target.postSlug}`)
  return { ok: true, alreadyReacted }
}

/**
 * Quita la reacción del actor. Idempotente: si no existía, `removed: false`.
 */
export async function unreactAction(input: unknown): Promise<{ ok: true; removed: boolean }> {
  const parsed = unreactInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  const data = parsed.data

  const target = await resolveReactableTarget(data.targetType, data.targetId)
  const actor = await resolveActorForPlace({ placeId: target.placeId })

  const deleted = await prisma.reaction.deleteMany({
    where: {
      targetType: data.targetType,
      targetId: data.targetId,
      userId: actor.actorId,
      emoji: data.emoji,
    },
  })

  logger.info(
    {
      event: 'reactionRemoved',
      placeId: actor.placeId,
      targetType: data.targetType,
      targetId: data.targetId,
      emoji: data.emoji,
      actorId: actor.actorId,
      removed: deleted.count > 0,
    },
    'reaction removed',
  )

  revalidatePath(`/${actor.placeSlug}/conversations/${target.postSlug}`)
  return { ok: true, removed: deleted.count > 0 }
}

/**
 * Resuelve el `placeId` + `postSlug` del target polimórfico (`POST` o `COMMENT`)
 * y asegura que el contenido esté activo — no se reacciona a posts ocultos/deletados
 * ni a comments deletados. El `postSlug` se usa para invalidar la página de detalle.
 */
async function resolveReactableTarget(
  targetType: 'POST' | 'COMMENT',
  targetId: string,
): Promise<{ placeId: string; postSlug: string }> {
  if (targetType === 'POST') {
    const post = await prisma.post.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        placeId: true,
        slug: true,
        hiddenAt: true,
      },
    })
    if (!post) throw new NotFoundError('Post no encontrado.', { postId: targetId })
    assertPostOpenForActivity(post)
    return { placeId: post.placeId, postSlug: post.slug }
  }
  const comment = await prisma.comment.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      placeId: true,
      deletedAt: true,
      post: { select: { slug: true } },
    },
  })
  if (!comment) {
    throw new NotFoundError('Comentario no encontrado.', { commentId: targetId })
  }
  assertCommentAlive(comment)
  return { placeId: comment.placeId, postSlug: comment.post.slug }
}
