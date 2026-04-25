import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { logger } from '@/shared/lib/logger'
import type { ErasureMembershipCounts, ErasureRunResult, ErasureSnapshotBeforeEntry } from './types'

/**
 * Job del erasure 365d (C.L — derecho al olvido estructurado).
 *
 * Para cada `Membership` con `leftAt + 365d < now()` Y `erasureAppliedAt
 * IS NULL` Y `place.archivedAt IS NULL`:
 *  1. Captura `snapshotsBefore` (Post + Comment authorSnapshot) en
 *     `ErasureAuditLog` para rollback manual si se detecta bug.
 *  2. `UPDATE Post / Comment SET authorUserId = NULL, authorSnapshot =
 *     jsonb_set(..., 'ex-miembro')`.
 *  3. Marca `Membership.erasureAppliedAt = now()`.
 *
 * Todo en una tx por membership (all-or-nothing). Si falla, la
 * membership no se marca y se reintenta al día siguiente. Idempotente vía
 * el filtro `erasureAppliedAt IS NULL`.
 *
 * Garantías:
 * - **Concurrency**: advisory lock Postgres al inicio. Si otro worker
 *   tiene el lock, retorna noop.
 * - **Safety threshold**: skipea membresías con `leftAt` > 10 años atrás
 *   (señal de bug en el setter).
 * - **Places archivados skipeados**: decisión de producto.
 * - **Dry-run**: captura snapshots pero rollbackea la tx sin aplicar
 *   UPDATEs. Permite inspección pre-primer-run.
 *
 * Ver `docs/decisions/2026-04-24-erasure-365d.md`.
 */

const ERASURE_WINDOW_MS = 365 * 24 * 60 * 60 * 1000
const SAFETY_THRESHOLD_MS = 10 * 365 * 24 * 60 * 60 * 1000
const BATCH_LIMIT = 500
const EX_MEMBER_DISPLAY = 'ex-miembro'
const ADVISORY_LOCK_KEY = 36524 // constante arbitraria hashable estable

type EligibleMembership = {
  id: string
  userId: string
  placeId: string
  leftAt: Date | null
}

export async function runErasure(opts: { dryRun: boolean; now?: Date }): Promise<ErasureRunResult> {
  const now = opts.now ?? new Date()
  const acquired = await tryAcquireLock()
  if (!acquired) {
    logger.warn({ event: 'erasureLockContention' }, 'another erasure run in flight, skipping')
    return emptyResult(opts.dryRun)
  }
  try {
    return await processEligible(opts.dryRun, now)
  } finally {
    await releaseLock()
  }
}

async function tryAcquireLock(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>(
    Prisma.sql`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) as locked`,
  )
  return rows[0]?.locked === true
}

async function releaseLock(): Promise<void> {
  await prisma.$queryRaw(Prisma.sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`)
}

async function processEligible(dryRun: boolean, now: Date): Promise<ErasureRunResult> {
  const cutoff = new Date(now.getTime() - ERASURE_WINDOW_MS)
  const safetyFloor = new Date(now.getTime() - SAFETY_THRESHOLD_MS)

  const eligible = (await prisma.membership.findMany({
    where: {
      leftAt: { lt: cutoff, gt: safetyFloor },
      erasureAppliedAt: null,
      place: { archivedAt: null },
    },
    select: { id: true, userId: true, placeId: true, leftAt: true },
    take: BATCH_LIMIT,
  })) as EligibleMembership[]

  const result = emptyResult(dryRun)

  for (const m of eligible) {
    try {
      const counts = await processOneMembership(m, now, dryRun)
      result.membershipsProcessed += 1
      result.postsAnonymized += counts.posts
      result.commentsAnonymized += counts.comments
      result.eventsAnonymized += counts.events
      result.rsvpsDeleted += counts.rsvpsDeleted
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errorsPerMembership.push({ membershipId: m.id, error: msg })
      logger.error(
        { event: 'erasureMembershipFailed', membershipId: m.id, err: msg },
        'erasure failed for one membership',
      )
    }
  }

  logger.info(
    { event: 'erasureRun', ...result },
    dryRun ? 'erasure dry run complete' : 'erasure applied',
  )
  return result
}

/**
 * `DryRunAbort` fuerza el rollback de la tx sin propagar como error
 * lógico. El caller captura y devuelve los counts como si hubiera corrido.
 */
class DryRunAbort extends Error {
  constructor(public readonly counts: ErasureMembershipCounts) {
    super('dry-run rollback')
    this.name = 'DryRunAbort'
  }
}

async function processOneMembership(
  m: EligibleMembership,
  now: Date,
  dryRun: boolean,
): Promise<ErasureMembershipCounts> {
  try {
    return await prisma.$transaction(async (tx) => {
      const posts = (await tx.post.findMany({
        where: { authorUserId: m.userId, placeId: m.placeId },
        select: { id: true, authorSnapshot: true },
      })) as Array<{
        id: string
        authorSnapshot: { displayName: string; avatarUrl: string | null }
      }>
      const comments = (await tx.comment.findMany({
        where: { authorUserId: m.userId, placeId: m.placeId },
        select: { id: true, authorSnapshot: true },
      })) as Array<{
        id: string
        authorSnapshot: { displayName: string; avatarUrl: string | null }
      }>
      const events = (await tx.event.findMany({
        where: { authorUserId: m.userId, placeId: m.placeId },
        select: { id: true, authorSnapshot: true },
      })) as Array<{
        id: string
        authorSnapshot: { displayName: string; avatarUrl: string | null }
      }>

      const snapshotsBefore: ErasureSnapshotBeforeEntry[] = [
        ...posts.map((p) => ({
          type: 'POST' as const,
          id: p.id,
          displayName: p.authorSnapshot.displayName,
          avatarUrl: p.authorSnapshot.avatarUrl,
        })),
        ...comments.map((c) => ({
          type: 'COMMENT' as const,
          id: c.id,
          displayName: c.authorSnapshot.displayName,
          avatarUrl: c.authorSnapshot.avatarUrl,
        })),
        ...events.map((e) => ({
          type: 'EVENT' as const,
          id: e.id,
          displayName: e.authorSnapshot.displayName,
          avatarUrl: e.authorSnapshot.avatarUrl,
        })),
      ]

      await tx.erasureAuditLog.create({
        data: {
          membershipId: m.id,
          userId: m.userId,
          placeId: m.placeId,
          postIds: posts.map((p) => p.id),
          commentIds: comments.map((c) => c.id),
          snapshotsBefore: snapshotsBefore as unknown as Prisma.InputJsonValue,
          dryRun,
        },
      })

      if (dryRun) {
        // En dry-run no contamos `rsvpsDeleted` porque el deleteMany no se
        // ejecuta. Los counts informativos reportan posts + comments + events
        // que SE HABRÍAN anonimizado.
        throw new DryRunAbort({
          posts: posts.length,
          comments: comments.length,
          events: events.length,
          rsvpsDeleted: 0,
        })
      }

      await tx.$executeRaw(Prisma.sql`
        UPDATE "Post" SET
          "authorUserId" = NULL,
          "authorSnapshot" = jsonb_set("authorSnapshot", '{displayName}', ${Prisma.raw(`'"${EX_MEMBER_DISPLAY}"'`)}::jsonb)
        WHERE "authorUserId" = ${m.userId} AND "placeId" = ${m.placeId}
      `)
      await tx.$executeRaw(Prisma.sql`
        UPDATE "Comment" SET
          "authorUserId" = NULL,
          "authorSnapshot" = jsonb_set("authorSnapshot", '{displayName}', ${Prisma.raw(`'"${EX_MEMBER_DISPLAY}"'`)}::jsonb)
        WHERE "authorUserId" = ${m.userId} AND "placeId" = ${m.placeId}
      `)
      // 3ª UPDATE: Event (F.C Fase 6, PR-3). Mismo patrón que Post/Comment.
      await tx.$executeRaw(Prisma.sql`
        UPDATE "Event" SET
          "authorUserId" = NULL,
          "authorSnapshot" = jsonb_set("authorSnapshot", '{displayName}', ${Prisma.raw(`'"${EX_MEMBER_DISPLAY}"'`)}::jsonb)
        WHERE "authorUserId" = ${m.userId} AND "placeId" = ${m.placeId}
      `)

      // DELETE EventRSVP del ex-miembro **sólo en el place que dejó** (filtro
      // nested vía `event.placeId`). NO global: si el user sigue activo en
      // otros places, sus RSVPs allá se preservan como parte de su vida
      // activa. Ver spec-integrations.md § 3.4.
      const deletedRsvps = await tx.eventRSVP.deleteMany({
        where: { userId: m.userId, event: { placeId: m.placeId } },
      })

      await tx.membership.update({
        where: { id: m.id },
        data: { erasureAppliedAt: now },
      })

      return {
        posts: posts.length,
        comments: comments.length,
        events: events.length,
        rsvpsDeleted: deletedRsvps.count,
      }
    })
  } catch (err) {
    if (err instanceof DryRunAbort) return err.counts
    throw err
  }
}

function emptyResult(dryRun: boolean): ErasureRunResult {
  return {
    dryRun,
    membershipsProcessed: 0,
    postsAnonymized: 0,
    commentsAnonymized: 0,
    eventsAnonymized: 0,
    rsvpsDeleted: 0,
    errorsPerMembership: [],
  }
}
