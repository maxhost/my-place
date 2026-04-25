import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { serverEnv } from '@/shared/config/env'
import { logger } from '@/shared/lib/logger'
import { runErasure } from '@/features/members/public'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * GET /api/cron/erasure[?dryRun=true]
 *
 * Invocado por Vercel Cron diariamente (03:00 UTC, `vercel.json`).
 * También invocable manualmente con `Authorization: Bearer <CRON_SECRET>`
 * para forzar un run o inspeccionar con `?dryRun=true`.
 *
 * Response shape (JSON): `{ ok: true, ...ErasureRunResult }` con campos:
 * `dryRun`, `membershipsProcessed`, `postsAnonymized`, `commentsAnonymized`,
 * `eventsAnonymized` (F.C Fase 6 — eventos anonimizados),
 * `rsvpsDeleted` (F.C Fase 6 — RSVPs DELETEadas en places que el user dejó,
 * scope per-place; no global), `errorsPerMembership`.
 *
 * Gate: sin header correcto → 401. Sin `CRON_SECRET` en env → 401 (el
 * endpoint nunca funciona). Comparación timing-safe.
 *
 * Vercel Cron:
 * - Usa GET (NO POST — error común).
 * - NO reintenta ante 5xx.
 * - PUEDE entregar el mismo evento 2x → `runErasure` usa advisory lock.
 * - Inyecta automáticamente el header `Authorization: Bearer
 *   <CRON_SECRET>` si la env var está configurada en el proyecto.
 *
 * Ver `docs/decisions/2026-04-24-erasure-365d.md` y
 * `docs/features/events/spec-integrations.md § 3` (extensión PR-3).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  // `new URL(req.url)` funciona igual en `NextRequest` y `Request` nativo,
  // lo que permite que los tests pasen un `Request` sin `nextUrl`.
  const dryRun = new URL(req.url).searchParams.get('dryRun') === 'true'
  try {
    const result = await runErasure({ dryRun })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    logger.error({ err, event: 'cronErasureFailed' }, 'erasure cron failed')
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

function isAuthorized(req: NextRequest): boolean {
  const secret = serverEnv.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  if (header.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  } catch {
    return false
  }
}
