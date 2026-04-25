'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { logger } from '@/shared/lib/logger'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { hardDeletePost } from '@/features/discussions/public.server'
import { FlagAlreadyExists } from '../domain/errors'
import { flagInputSchema, reviewFlagInputSchema } from '../schemas'
import { resolveActorForPlace, type FlagActor } from './actor'

type FlagRecord = {
  id: string
  placeId: string
  status: string
  // F.C: el enum DB acepta EVENT, pero el review action de moderación todavía
  // sólo procesa POST/COMMENT (admin actúa sobre eventos cancelando vía
  // /events/[id]/edit, no via flag queue). El guard en `loadAndAuthorizeFlag`
  // rechaza EVENT antes de devolver este record. F.D / post-F1 puede agregar
  // un sideEffect `CANCEL_EVENT` si producto lo pide.
  targetType: 'POST' | 'COMMENT'
  targetId: string
}

type ReviewInput = ReturnType<typeof parseReviewInput>

/**
 * Crea un flag sobre un Post o Comment. UNIQUE `(targetType, targetId, reporterUserId)`
 * evita duplicados — un user no puede reportar la misma pieza dos veces. El
 * flag no requiere que el place esté abierto: moderación es meta-nivel.
 */
export async function flagAction(input: unknown): Promise<{ ok: true; flagId: string }> {
  const data = parseFlagInput(input)
  const target = await resolveFlaggableTarget(data.targetType, data.targetId)
  const actor = await resolveActorForPlace({ placeId: target.placeId })
  const flagId = await createFlagOrConflict(data, target.placeId, actor.actorId)

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

function parseFlagInput(input: unknown): ReturnType<typeof flagInputSchema.parse> {
  const parsed = flagInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  return parsed.data
}

/**
 * Insert con guard de duplicado (UNIQUE `(targetType, targetId,
 * reporterUserId)`). Mapea P2002 → `FlagAlreadyExists` typed.
 */
async function createFlagOrConflict(
  data: ReturnType<typeof parseFlagInput>,
  placeId: string,
  reporterUserId: string,
): Promise<string> {
  try {
    const created = await prisma.flag.create({
      data: {
        targetType: data.targetType,
        targetId: data.targetId,
        placeId,
        reporterUserId,
        reason: data.reason,
        reasonNote: data.reasonNote ?? null,
      },
      select: { id: true },
    })
    return created.id
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new FlagAlreadyExists({
        targetType: data.targetType,
        targetId: data.targetId,
        reporterUserId,
      })
    }
    throw err
  }
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
 * row desaparece cuando `hardDeletePost` hace el `flag.deleteMany` interno.
 */
export async function reviewFlagAction(input: unknown): Promise<{ ok: true }> {
  const data = parseReviewInput(input)
  const { flag, actor } = await loadAndAuthorizeFlag(data)

  if (data.sideEffect === 'DELETE_TARGET' && flag.targetType === 'POST') {
    await reviewFlagPostHardDelete(flag, actor, data)
    return { ok: true }
  }

  const targetPostSlug = await reviewFlagTx(flag, actor, data)
  logFlagReviewed(actor, flag, data)
  revalidateFlagPaths(actor, flag, data, targetPostSlug)
  return { ok: true }
}

function parseReviewInput(input: unknown) {
  const parsed = reviewFlagInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  return parsed.data
}

async function loadAndAuthorizeFlag(
  data: ReviewInput,
): Promise<{ flag: FlagRecord; actor: FlagActor }> {
  const flag = await prisma.flag.findUnique({
    where: { id: data.flagId },
    select: { id: true, placeId: true, status: true, targetType: true, targetId: true },
  })
  if (!flag) throw new NotFoundError('Flag no encontrado.', { flagId: data.flagId })

  const actor = await resolveActorForPlace({ placeId: flag.placeId })
  if (!actor.isAdmin) {
    throw new AuthorizationError('Sólo admins pueden revisar flags.', { flagId: flag.id })
  }

  if (flag.targetType === 'EVENT') {
    // F.C: la cola admin renderiza EVENT flags (mapper + queries lo soportan)
    // pero el review action no aplica HIDE/DELETE sobre eventos — el patrón
    // para moderar un evento es cancelarlo desde `/events/[id]/edit`. Hasta
    // que F.D o post-F1 agreguen un sideEffect `CANCEL_EVENT`, rechazamos
    // las acciones de review sobre EVENT con un mensaje claro.
    throw new ValidationError('Para moderar un evento, cancelalo desde su detalle.', {
      flagId: flag.id,
      targetType: flag.targetType,
    })
  }

  if (data.sideEffect === 'HIDE_TARGET' && flag.targetType === 'COMMENT') {
    throw new ValidationError('Los comentarios se eliminan, no se ocultan.', {
      flagId: flag.id,
      targetType: flag.targetType,
    })
  }

  // El guard sobre 'EVENT' arriba garantiza targetType ∈ {'POST','COMMENT'},
  // pero TS no propaga el narrowing al objeto entero — assertion segura.
  return { flag: flag as FlagRecord, actor }
}

/**
 * Rama DELETE_TARGET + POST: fuera de tx porque `hardDeletePost` borra el
 * flag internamente. Orden: (1) cargar post.slug (revalidate), (2) claim del
 * flag con guard status=OPEN, (3) hardDelete, (4) revalidate.
 */
async function reviewFlagPostHardDelete(
  flag: FlagRecord,
  actor: FlagActor,
  data: ReviewInput,
): Promise<void> {
  const post = await prisma.post.findUnique({
    where: { id: flag.targetId },
    select: { slug: true },
  })
  if (!post) throw new NotFoundError('Post ya fue eliminado.', { postId: flag.targetId })

  const claimed = await prisma.flag.updateMany({
    where: { id: flag.id, status: 'OPEN' },
    data: {
      status: data.decision,
      reviewedAt: new Date(),
      reviewerAdminUserId: actor.actorId,
      reviewNote: data.reviewNote ?? null,
    },
  })
  if (claimed.count === 0) {
    throw new NotFoundError('El flag ya fue resuelto por otro admin.', { flagId: flag.id })
  }

  await hardDeletePost(flag.targetId)
  logFlagReviewed(actor, flag, data)
  revalidatePath(`/${actor.placeSlug}/settings/flags`)
  revalidatePath(`/${actor.placeSlug}/conversations`)
  revalidatePath(`/${actor.placeSlug}/conversations/${post.slug}`)
}

/**
 * Rama genérica: update del flag + sideEffect (HIDE_POST, DELETE_COMMENT, o
 * ninguno) en una sola tx. Retorna `targetPostSlug` del post afectado (o del
 * padre en DELETE_COMMENT) para que el caller revalide.
 */
async function reviewFlagTx(
  flag: FlagRecord,
  actor: FlagActor,
  data: ReviewInput,
): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.flag.updateMany({
      where: { id: flag.id, status: 'OPEN' },
      data: {
        status: data.decision,
        reviewedAt: new Date(),
        reviewerAdminUserId: actor.actorId,
        reviewNote: data.reviewNote ?? null,
      },
    })
    if (updated.count === 0) {
      throw new NotFoundError('El flag ya fue resuelto por otro admin.', { flagId: flag.id })
    }
    if (data.sideEffect === null) return null

    if (flag.targetType === 'POST') {
      const post = await tx.post.update({
        where: { id: flag.targetId },
        data: { hiddenAt: new Date() },
        select: { slug: true },
      })
      return post.slug
    }

    const comment = await tx.comment.update({
      where: { id: flag.targetId },
      data: { deletedAt: new Date() },
      select: { postId: true },
    })
    const parentPost = await tx.post.findUnique({
      where: { id: comment.postId },
      select: { slug: true },
    })
    return parentPost?.slug ?? null
  })
}

function logFlagReviewed(actor: FlagActor, flag: FlagRecord, data: ReviewInput): void {
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
}

function revalidateFlagPaths(
  actor: FlagActor,
  flag: FlagRecord,
  data: ReviewInput,
  targetPostSlug: string | null,
): void {
  revalidatePath(`/${actor.placeSlug}/settings/flags`)
  if (data.sideEffect === null) return
  if (flag.targetType === 'POST') {
    revalidatePath(`/${actor.placeSlug}/conversations`)
    if (targetPostSlug) revalidatePath(`/${actor.placeSlug}/conversations/${targetPostSlug}`)
  } else if (data.sideEffect === 'DELETE_TARGET' && targetPostSlug) {
    revalidatePath(`/${actor.placeSlug}/conversations/${targetPostSlug}`)
  }
}

async function resolveFlaggableTarget(
  targetType: 'POST' | 'COMMENT' | 'EVENT',
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
  if (targetType === 'COMMENT') {
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
  // EVENT
  const event = await prisma.event.findUnique({
    where: { id: targetId },
    select: { id: true, placeId: true },
  })
  if (!event) throw new NotFoundError('Evento no encontrado.', { eventId: targetId })
  return { placeId: event.placeId }
}
