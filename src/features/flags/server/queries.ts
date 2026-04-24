import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { FLAG_PAGE_SIZE } from '../domain/invariants'
import type { Flag, FlagReason, FlagStatus, FlagTargetSnapshot } from '../domain/types'

/**
 * Queries del slice `flags`. Sólo este archivo + `server/actions.ts` tocan Prisma.
 * El resto del slice los consume vía `public.ts`.
 *
 * `listFlagsByPlace` devuelve los flags "crudos" del dominio; el mapping a la
 * view que renderiza la cola admin vive en `flag-view-mapper.ts` y consume
 * `listFlagTargetSnapshots` — diseño explicado en
 * `docs/decisions/2026-04-21-flags-subslice-split.md` §4.
 */

type Cursor = { createdAt: Date; id: string }

export async function listFlagsByPlace(params: {
  placeId: string
  status?: FlagStatus | readonly FlagStatus[]
  cursor?: Cursor | null
  pageSize?: number
}): Promise<{ items: Flag[]; nextCursor: Cursor | null }> {
  const pageSize = params.pageSize ?? FLAG_PAGE_SIZE
  const statusFilter = Array.isArray(params.status)
    ? { status: { in: [...params.status] } }
    : params.status
      ? { status: params.status as FlagStatus }
      : {}
  const where: Prisma.FlagWhereInput = {
    placeId: params.placeId,
    ...statusFilter,
    ...(params.cursor
      ? {
          OR: [
            { createdAt: { lt: params.cursor.createdAt } },
            { createdAt: params.cursor.createdAt, id: { lt: params.cursor.id } },
          ],
        }
      : {}),
  }

  const rows = await prisma.flag.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: pageSize + 1,
  })

  const hasMore = rows.length > pageSize
  const items = (hasMore ? rows.slice(0, pageSize) : rows).map(mapFlag)
  const last = items[items.length - 1]
  const nextCursor = hasMore && last ? { createdAt: last.createdAt, id: last.id } : null
  return { items, nextCursor }
}

export async function countOpenFlags(placeId: string): Promise<number> {
  return prisma.flag.count({ where: { placeId, status: 'OPEN' } })
}

type PostSnapshotRow = {
  id: string
  title: string
  body: unknown
  hiddenAt: Date | null
  slug: string
}

type CommentSnapshotRow = {
  id: string
  body: unknown
  deletedAt: Date | null
  postId: string
  post: { slug: string } | null
}

/**
 * Resuelve en batch los snapshots de los targets flageados. Hace a lo sumo
 * 2 `findMany` (post + comment) agrupadas en un solo `$transaction` — O(1)
 * round-trips independiente del tamaño de la cola. Si el target fue
 * eliminado entre el flag y el read, la key simplemente no aparece en el
 * `Map` — el mapper resuelve eso a `contentStatus: 'DELETED'`.
 */
export async function listFlagTargetSnapshots(
  flags: readonly Flag[],
): Promise<Map<string, FlagTargetSnapshot>> {
  const result = new Map<string, FlagTargetSnapshot>()
  if (flags.length === 0) return result
  const { postIds, commentIds } = collectFlagTargetIds(flags)
  const { posts, comments } = await fetchFlagTargetsBatch(postIds, commentIds)
  for (const p of posts) result.set(`POST:${p.id}`, mapPostSnapshot(p))
  for (const c of comments) result.set(`COMMENT:${c.id}`, mapCommentSnapshot(c))
  return result
}

function collectFlagTargetIds(flags: readonly Flag[]): {
  postIds: string[]
  commentIds: string[]
} {
  const postIds = [...new Set(flags.filter((f) => f.targetType === 'POST').map((f) => f.targetId))]
  const commentIds = [
    ...new Set(flags.filter((f) => f.targetType === 'COMMENT').map((f) => f.targetId)),
  ]
  return { postIds, commentIds }
}

/**
 * Ejecuta los 2 `findMany` (post + comment) en un solo `$transaction` para
 * snapshot isolation. Cada rama se agrega al batch sólo si hay ids — evita
 * queries triviales. Retorna arrays tipados para que el caller no haga casts.
 */
async function fetchFlagTargetsBatch(
  postIds: string[],
  commentIds: string[],
): Promise<{ posts: PostSnapshotRow[]; comments: CommentSnapshotRow[] }> {
  const ops: Prisma.PrismaPromise<unknown>[] = []
  if (postIds.length > 0) {
    ops.push(
      prisma.post.findMany({
        where: { id: { in: postIds } },
        select: { id: true, title: true, body: true, hiddenAt: true, slug: true },
      }),
    )
  }
  if (commentIds.length > 0) {
    ops.push(
      prisma.comment.findMany({
        where: { id: { in: commentIds } },
        select: {
          id: true,
          body: true,
          deletedAt: true,
          postId: true,
          post: { select: { slug: true } },
        },
      }),
    )
  }
  if (ops.length === 0) return { posts: [], comments: [] }
  const results = (await prisma.$transaction(ops)) as unknown[]
  let idx = 0
  const posts = postIds.length > 0 ? (results[idx++] as PostSnapshotRow[]) : []
  const comments = commentIds.length > 0 ? (results[idx++] as CommentSnapshotRow[]) : []
  return { posts, comments }
}

function mapPostSnapshot(row: PostSnapshotRow): FlagTargetSnapshot {
  return {
    targetType: 'POST',
    targetId: row.id,
    title: row.title,
    body: row.body,
    hiddenAt: row.hiddenAt,
    slug: row.slug,
  }
}

function mapCommentSnapshot(row: CommentSnapshotRow): FlagTargetSnapshot {
  return {
    targetType: 'COMMENT',
    targetId: row.id,
    body: row.body,
    deletedAt: row.deletedAt,
    postId: row.postId,
    postSlug: row.post?.slug ?? null,
  }
}

type FlagRow = Prisma.FlagGetPayload<Record<string, never>>

function mapFlag(row: FlagRow): Flag {
  return {
    id: row.id,
    targetType: row.targetType,
    targetId: row.targetId,
    placeId: row.placeId,
    reporterUserId: row.reporterUserId,
    reason: row.reason as FlagReason,
    reasonNote: row.reasonNote,
    status: row.status as FlagStatus,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    reviewerAdminUserId: row.reviewerAdminUserId,
    reviewNote: row.reviewNote,
  }
}
