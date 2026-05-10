'use server'

import { prisma } from '@/db/client'
import { logger } from '@/shared/lib/logger'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'
import { deletePostInputSchema } from '@/features/discussions/schemas'
import { canDeleteContent, editWindowOpen } from '@/features/discussions/domain/invariants'
import { EditWindowExpired } from '@/features/discussions/domain/errors'
import { resolveActorForPlace, type DiscussionActor } from '@/features/discussions/server/actor'
import { hardDeletePost } from '@/features/discussions/server/hard-delete'
import { hasPermission } from '@/features/members/public.server'
import { revalidatePostPaths } from './shared'

type PostForDelete = {
  id: string
  placeId: string
  authorUserId: string | null
  slug: string
  createdAt: Date
  version: number
}

/**
 * Borra un Post (hard delete). Autor dentro de 60s; admin siempre. La fila
 * desaparece y con ella cascade los `Comment` y `PostRead` (FK CASCADE).
 * `Reaction` y `Flag` son polimórficos — `hardDeletePost` los limpia a mano
 * en la misma tx. Irreversible. Ver ADR `2026-04-21-post-hard-delete.md`.
 */
export async function deletePostAction(input: unknown): Promise<{ ok: true }> {
  const parsed = deletePostInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  const data = parsed.data

  const post = await fetchPostForDelete(data.postId)
  const actor = await resolveActorForPlace({ placeId: post.placeId })
  const now = new Date()

  // G.3 port (2026-05-09): owner + grupos con `discussions:delete-post`
  // pueden borrar posts ajenos. Override de `actor.isAdmin` para que
  // `canDeleteContent` lo respete sin tocar el dominio. Ver
  // `docs/plans/2026-05-09-g3-debt-port-to-legacy.md` § A4.
  const canModerate = await hasPermission(actor.actorId, actor.placeId, 'discussions:delete-post')
  const effectiveActor = { ...actor, isAdmin: canModerate || actor.isAdmin }
  authorizePostDelete(effectiveActor, post, now)
  if (post.version !== data.expectedVersion) {
    throw new ConflictError('El post cambió desde que lo abriste.', {
      postId: post.id,
      expectedVersion: data.expectedVersion,
    })
  }

  await hardDeletePost(post.id)
  logPostDeleted(effectiveActor, post)
  revalidatePostPaths(actor.placeSlug, post.slug)
  return { ok: true }
}

async function fetchPostForDelete(postId: string): Promise<PostForDelete> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      placeId: true,
      authorUserId: true,
      slug: true,
      createdAt: true,
      version: true,
    },
  })
  if (!post) throw new NotFoundError('Post no encontrado.', { postId })
  return post
}

function authorizePostDelete(actor: DiscussionActor, post: PostForDelete, now: Date): void {
  if (canDeleteContent(actor, post.authorUserId, post.createdAt, now)) return

  // Error más específico si el problema es la ventana del autor, no la autoría.
  if (
    !actor.isAdmin &&
    post.authorUserId === actor.actorId &&
    !editWindowOpen(post.createdAt, now)
  ) {
    throw new EditWindowExpired({
      entityId: post.id,
      createdAt: post.createdAt,
      now,
      elapsedMs: now.getTime() - post.createdAt.getTime(),
    })
  }
  throw new AuthorizationError('No podés borrar este post.', { postId: post.id })
}

function logPostDeleted(actor: DiscussionActor, post: PostForDelete): void {
  logger.info(
    {
      event: 'postDeleted',
      placeId: actor.placeId,
      postId: post.id,
      actorId: actor.actorId,
      actorRole: actor.isAdmin ? 'admin' : 'author',
      byAdmin: actor.isAdmin && post.authorUserId !== actor.actorId,
    },
    'post deleted (hard)',
  )
}
