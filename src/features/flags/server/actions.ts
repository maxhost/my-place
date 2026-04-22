'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { logger } from '@/shared/lib/logger'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { hardDeletePost } from '@/features/discussions/public.server'
import { FlagAlreadyExists } from '../domain/errors'
import { flagInputSchema, reviewFlagInputSchema } from '../schemas'
import { resolveActorForPlace } from './actor'

/**
 * Crea un flag sobre un Post o Comment. UNIQUE `(targetType, targetId, reporterUserId)`
 * evita duplicados — un user no puede reportar la misma pieza dos veces. El
 * flag no requiere que el place esté abierto: moderación es meta-nivel.
 */
export async function flagAction(input: unknown): Promise<{ ok: true; flagId: string }> {
  const parsed = flagInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  const data = parsed.data

  const target = await resolveFlaggableTarget(data.targetType, data.targetId)
  const actor = await resolveActorForPlace({ placeId: target.placeId })

  let flagId: string
  try {
    const created = await prisma.flag.create({
      data: {
        targetType: data.targetType,
        targetId: data.targetId,
        placeId: target.placeId,
        reporterUserId: actor.actorId,
        reason: data.reason,
        reasonNote: data.reasonNote ?? null,
      },
      select: { id: true },
    })
    flagId = created.id
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new FlagAlreadyExists({
        targetType: data.targetType,
        targetId: data.targetId,
        reporterUserId: actor.actorId,
      })
    }
    throw err
  }

  logger.info(
    {
      event: 'flagCreated',
      placeId: actor.placeId,
      targetType: data.targetType,
      targetId: data.targetId,
      flagId,
      reason: data.reason,
      actorId: actor.actorId,
    },
    'flag created',
  )

  revalidatePath(`/${actor.placeSlug}/settings/flags`)
  return { ok: true, flagId }
}

/**
 * Resuelve un flag: admin marca `REVIEWED_ACTIONED` (tomó medida) o
 * `REVIEWED_DISMISSED` (sin mérito). No reabre.
 *
 * `sideEffect` opcional combina, en la misma transacción, el update del flag
 * con el side-effect sobre el target:
 *  - `HIDE_TARGET` sobre `POST` → `post.update({ hiddenAt })`.
 *  - `DELETE_TARGET` sobre `POST` → **hard delete** via `hardDeletePost`
 *    (drop del row + CASCADE sobre comments/postReads + limpieza
 *    polimórfica de reactions/flags). Ver C.G.1.
 *  - `DELETE_TARGET` sobre `COMMENT` → soft delete `comment.update({ deletedAt })`
 *    (comments preservan estructura del thread con placeholder `[mensaje eliminado]`).
 *  - `HIDE_TARGET` sobre `COMMENT` → `ValidationError` (comments no se ocultan).
 *  - `DISMISSED` + `sideEffect` → rechazado por schema (refine).
 *
 * Concurrencia: `updateMany({ status: 'OPEN' })` como guard. Si otro admin
 * ya lo resolvió, `count=0` ⇒ rollback completo de la tx + `NotFoundError`.
 *
 * Hard delete sobre POST sale fuera de la tx del flag update porque el flag
 * row desaparece cuando `hardDeletePost` hace el `flag.deleteMany` interno —
 * si intentaramos updateMany después, no habría a qué escribir. Orden:
 * 1) cargar el postSlug (para revalidar), 2) update del flag + guard race,
 * 3) hard delete (atomic por sí mismo), 4) revalidate.
 */
export async function reviewFlagAction(input: unknown): Promise<{ ok: true }> {
  const parsed = reviewFlagInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  const data = parsed.data

  const flag = await prisma.flag.findUnique({
    where: { id: data.flagId },
    select: { id: true, placeId: true, status: true, targetType: true, targetId: true },
  })
  if (!flag) throw new NotFoundError('Flag no encontrado.', { flagId: data.flagId })

  const actor = await resolveActorForPlace({ placeId: flag.placeId })
  if (!actor.isAdmin) {
    throw new AuthorizationError('Sólo admins pueden revisar flags.', {
      flagId: flag.id,
    })
  }

  if (data.sideEffect === 'HIDE_TARGET' && flag.targetType === 'COMMENT') {
    throw new ValidationError('Los comentarios se eliminan, no se ocultan.', {
      flagId: flag.id,
      targetType: flag.targetType,
    })
  }

  const now = new Date()

  if (data.sideEffect === 'DELETE_TARGET' && flag.targetType === 'POST') {
    const post = await prisma.post.findUnique({
      where: { id: flag.targetId },
      select: { slug: true },
    })
    if (!post) {
      throw new NotFoundError('Post ya fue eliminado.', { postId: flag.targetId })
    }
    const claimed = await prisma.flag.updateMany({
      where: { id: flag.id, status: 'OPEN' },
      data: {
        status: data.decision,
        reviewedAt: now,
        reviewerAdminUserId: actor.actorId,
        reviewNote: data.reviewNote ?? null,
      },
    })
    if (claimed.count === 0) {
      throw new NotFoundError('El flag ya fue resuelto por otro admin.', {
        flagId: flag.id,
      })
    }
    await hardDeletePost(flag.targetId)

    logger.info(
      {
        event: 'flagReviewed',
        placeId: actor.placeId,
        flagId: flag.id,
        decision: data.decision,
        sideEffect: data.sideEffect,
        targetType: flag.targetType,
        targetId: flag.targetId,
        actorId: actor.actorId,
      },
      'flag reviewed',
    )

    revalidatePath(`/${actor.placeSlug}/settings/flags`)
    revalidatePath(`/${actor.placeSlug}/conversations`)
    revalidatePath(`/${actor.placeSlug}/conversations/${post.slug}`)
    return { ok: true }
  }

  const targetPostSlug = await prisma.$transaction(async (tx) => {
    const updated = await tx.flag.updateMany({
      where: { id: flag.id, status: 'OPEN' },
      data: {
        status: data.decision,
        reviewedAt: now,
        reviewerAdminUserId: actor.actorId,
        reviewNote: data.reviewNote ?? null,
      },
    })
    if (updated.count === 0) {
      throw new NotFoundError('El flag ya fue resuelto por otro admin.', {
        flagId: flag.id,
      })
    }

    if (data.sideEffect === null) return null

    if (flag.targetType === 'POST') {
      const post = await tx.post.update({
        where: { id: flag.targetId },
        data: { hiddenAt: now },
        select: { slug: true },
      })
      return post.slug
    }

    const comment = await tx.comment.update({
      where: { id: flag.targetId },
      data: { deletedAt: now },
      select: { postId: true },
    })
    const parentPost = await tx.post.findUnique({
      where: { id: comment.postId },
      select: { slug: true },
    })
    return parentPost?.slug ?? null
  })

  logger.info(
    {
      event: 'flagReviewed',
      placeId: actor.placeId,
      flagId: flag.id,
      decision: data.decision,
      sideEffect: data.sideEffect,
      targetType: flag.targetType,
      targetId: flag.targetId,
      actorId: actor.actorId,
    },
    'flag reviewed',
  )

  revalidatePath(`/${actor.placeSlug}/settings/flags`)
  if (data.sideEffect !== null) {
    if (flag.targetType === 'POST') {
      revalidatePath(`/${actor.placeSlug}/conversations`)
      if (targetPostSlug) {
        revalidatePath(`/${actor.placeSlug}/conversations/${targetPostSlug}`)
      }
    } else if (data.sideEffect === 'DELETE_TARGET' && targetPostSlug) {
      revalidatePath(`/${actor.placeSlug}/conversations/${targetPostSlug}`)
    }
  }

  return { ok: true }
}

async function resolveFlaggableTarget(
  targetType: 'POST' | 'COMMENT',
  targetId: string,
): Promise<{ placeId: string }> {
  if (targetType === 'POST') {
    const post = await prisma.post.findUnique({
      where: { id: targetId },
      select: { id: true, placeId: true },
    })
    if (!post) throw new NotFoundError('Post no encontrado.', { postId: targetId })
    return { placeId: post.placeId }
  }
  const comment = await prisma.comment.findUnique({
    where: { id: targetId },
    select: { id: true, placeId: true, deletedAt: true },
  })
  if (!comment) {
    throw new NotFoundError('Comentario no encontrado.', { commentId: targetId })
  }
  if (comment.deletedAt) {
    throw new NotFoundError('Comentario ya fue eliminado.', { commentId: targetId })
  }
  return { placeId: comment.placeId }
}
