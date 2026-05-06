'use server'

import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { assertPlaceOpenOrThrow } from '@/features/hours/public.server'
import { logger } from '@/shared/lib/logger'
import { ConflictError, ValidationError } from '@/shared/errors/domain-error'
import { createPostInputSchema } from '@/features/discussions/schemas'
import { buildAuthorSnapshot } from '@/features/discussions/domain/invariants'
import { resolveActorForPlace, type DiscussionActor } from '@/features/discussions/server/actor'
import { resolveUniqueSlug, revalidatePostPaths } from './shared'

/**
 * Crea un Post nuevo en un place. Gate por `assertPlaceOpenOrThrow` y membership
 * activa. Slug derivado del título, único por `(placeId, slug)` — ante P2002
 * reintenta una vez con colisiones recalculadas; segundo fallo ⇒ `ConflictError`.
 */
export async function createPostAction(
  input: unknown,
): Promise<{ ok: true; postId: string; slug: string }> {
  const parsed = createPostInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para crear post.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const actor = await resolveActorForPlace({ placeId: data.placeId })
  await assertPlaceOpenOrThrow(actor.placeId)

  // stub F.1: validación de tamaño rich-text se reintroduce en F.2 con Lexical AST.

  const trimmedTitle = data.title.trim()
  const bodyJson = data.body ? (data.body as Prisma.InputJsonValue) : Prisma.JsonNull
  const now = new Date()
  const created = await createWithRetry(actor, trimmedTitle, bodyJson, now)

  logger.info(
    {
      event: 'postCreated',
      placeId: actor.placeId,
      postId: created.id,
      postSlug: created.slug,
      actorId: actor.actorId,
    },
    'post created',
  )

  revalidatePostPaths(actor.placeSlug, created.slug)
  return { ok: true, postId: created.id, slug: created.slug }
}

async function attemptCreate(
  actor: DiscussionActor,
  trimmedTitle: string,
  body: Prisma.InputJsonValue | typeof Prisma.JsonNull,
  now: Date,
): Promise<{ id: string; slug: string }> {
  const slug = await resolveUniqueSlug(actor.placeId, trimmedTitle)
  return prisma.post.create({
    data: {
      placeId: actor.placeId,
      authorUserId: actor.actorId,
      authorSnapshot: buildAuthorSnapshot(actor.user) as Prisma.InputJsonValue,
      title: trimmedTitle,
      slug,
      body,
      lastActivityAt: now,
    },
    select: { id: true, slug: true },
  })
}

async function createWithRetry(
  actor: DiscussionActor,
  trimmedTitle: string,
  body: Prisma.InputJsonValue | typeof Prisma.JsonNull,
  now: Date,
): Promise<{ id: string; slug: string }> {
  try {
    return await attemptCreate(actor, trimmedTitle, body, now)
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
      throw err
    }
    try {
      return await attemptCreate(actor, trimmedTitle, body, now)
    } catch (retryErr) {
      if (retryErr instanceof Prisma.PrismaClientKnownRequestError && retryErr.code === 'P2002') {
        throw new ConflictError('No pudimos asignar una URL única. Probá con otro título.', {
          placeId: actor.placeId,
          title: trimmedTitle,
        })
      }
      throw retryErr
    }
  }
}
