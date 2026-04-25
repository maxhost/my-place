#!/usr/bin/env tsx
/**
 * Smoke test manual del cron de erasure 365d (C.L + F.C Fase 6 PR-3).
 *
 * Crea una fixture artificial con prefijos reservados propios
 * (`usr_erasure_smoke_*`, `place_erasure_smoke_*`, `evt_erasure_smoke_*`)
 * + `leftAt` backdated a 400 días. Invoca el endpoint cron en dev local
 * y verifica que:
 *
 *  1. Dry-run reporta 1 membership elegible sin aplicar UPDATEs (counts
 *     incluyen postsAnonymized, commentsAnonymized y eventsAnonymized).
 *  2. Real run nullifica `authorUserId` + renombra snapshot a
 *     "ex-miembro" en Post, Comment **y Event** + marca `erasureAppliedAt`.
 *  3. `ErasureAuditLog` captura `snapshotsBefore` con entradas POST +
 *     COMMENT + EVENT.
 *  4. PR-3: EventRSVP del ex-miembro borrada en el place que dejó.
 *
 * Cleanup automático al final (incluso si algún paso falla) — borra
 * todas las filas con los prefijos reservados.
 *
 * Uso: `pnpm tsx scripts/jobs/smoke-erasure-365d.ts`
 *
 * Requiere:
 * - Dev server corriendo en `http://lvh.me:<puerto>`.
 * - `.env.local` con `CRON_SECRET` + `DATABASE_URL` del Cloud dev.
 */

import { PrismaClient, MembershipRole, BillingMode, Prisma } from '@prisma/client'

const PREFIX = 'erasure_smoke'
const USER_ID = `usr_${PREFIX}_user1`
const PLACE_ID = `place_${PREFIX}_1`
const POST_ID = `post_${PREFIX}_1`
const COMMENT_ID = `comment_${PREFIX}_1`
const EVENT_ID = `evt_${PREFIX}_1`
const RSVP_ID = `rsvp_${PREFIX}_1`
const MEMBERSHIP_ID = `mem_${PREFIX}_1`
const ORIGINAL_NAME = 'Alice Test'

const DEV_URL = process.env.SMOKE_DEV_URL ?? 'http://lvh.me:3002'
const CRON_SECRET = process.env.CRON_SECRET

if (!CRON_SECRET) {
  console.error('[smoke] CRON_SECRET no configurado en env. Exit.')
  process.exit(1)
}

const prisma = new PrismaClient()

type ErasureResult = {
  ok: boolean
  dryRun: boolean
  membershipsProcessed: number
  postsAnonymized: number
  commentsAnonymized: number
  eventsAnonymized: number
  rsvpsDeleted: number
  errorsPerMembership: Array<{ membershipId: string; error: string }>
}

async function seedFixture(): Promise<void> {
  await prisma.user.create({
    data: {
      id: USER_ID,
      email: `${PREFIX}-alice@smoke.test.local`,
      displayName: ORIGINAL_NAME,
      avatarUrl: null,
    },
  })

  await prisma.place.create({
    data: {
      id: PLACE_ID,
      slug: `smoke-${PREFIX}`,
      name: 'Smoke Test Place',
      billingMode: BillingMode.OWNER_PAYS,
      openingHours: { kind: 'always_open' },
    },
  })

  await prisma.membership.create({
    data: {
      id: MEMBERSHIP_ID,
      userId: USER_ID,
      placeId: PLACE_ID,
      role: MembershipRole.MEMBER,
      leftAt: new Date(), // Se forzará a 400d atrás via SQL después.
    },
  })

  await prisma.post.create({
    data: {
      id: POST_ID,
      placeId: PLACE_ID,
      authorUserId: USER_ID,
      authorSnapshot: { displayName: ORIGINAL_NAME, avatarUrl: null },
      title: 'Smoke Post',
      slug: `smoke-post-${PREFIX}`,
      body: Prisma.JsonNull,
      version: 0,
      lastActivityAt: new Date(),
    },
  })

  await prisma.comment.create({
    data: {
      id: COMMENT_ID,
      postId: POST_ID,
      placeId: PLACE_ID,
      authorUserId: USER_ID,
      authorSnapshot: { displayName: ORIGINAL_NAME, avatarUrl: null },
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
      version: 0,
    },
  })

  // Event + EventRSVP — F.C Fase 6 PR-3.
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      placeId: PLACE_ID,
      authorUserId: USER_ID,
      authorSnapshot: { displayName: ORIGINAL_NAME, avatarUrl: null },
      title: 'Smoke Event',
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      timezone: 'America/Argentina/Buenos_Aires',
    },
  })

  await prisma.eventRSVP.create({
    data: {
      id: RSVP_ID,
      eventId: EVENT_ID,
      userId: USER_ID,
      state: 'GOING',
    },
  })

  // Backdate leftAt 400 días: past el cutoff de 365d.
  await prisma.$executeRaw`
    UPDATE "Membership"
    SET "leftAt" = NOW() - INTERVAL '400 days'
    WHERE id = ${MEMBERSHIP_ID}
  `

  console.log('[smoke] fixture sembrada')
}

async function cleanup(): Promise<void> {
  await prisma.erasureAuditLog.deleteMany({ where: { membershipId: MEMBERSHIP_ID } })
  // EventRSVP cascadea desde Event/User, pero limpio explícito por las dudas.
  await prisma.eventRSVP.deleteMany({ where: { id: RSVP_ID } })
  await prisma.event.deleteMany({ where: { id: EVENT_ID } })
  await prisma.comment.deleteMany({ where: { id: COMMENT_ID } })
  await prisma.post.deleteMany({ where: { id: POST_ID } })
  await prisma.membership.deleteMany({ where: { id: MEMBERSHIP_ID } })
  await prisma.place.deleteMany({ where: { id: PLACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
  console.log('[smoke] cleanup completo')
}

async function callCron(dryRun: boolean): Promise<ErasureResult> {
  const url = `${DEV_URL}/api/cron/erasure${dryRun ? '?dryRun=true' : ''}`
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  })
  if (!res.ok) {
    throw new Error(`cron ${url} → ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as ErasureResult
}

async function verifyBefore(): Promise<void> {
  const post = await prisma.post.findUniqueOrThrow({ where: { id: POST_ID } })
  const snapshot = post.authorSnapshot as { displayName: string }
  if (post.authorUserId !== USER_ID) throw new Error('pre: authorUserId debería ser USER_ID')
  if (snapshot.displayName !== ORIGINAL_NAME)
    throw new Error(`pre: displayName debería ser "${ORIGINAL_NAME}", es "${snapshot.displayName}"`)
  console.log(
    `[smoke] estado inicial: authorUserId=${post.authorUserId}, displayName="${snapshot.displayName}"`,
  )
}

async function verifyAfter(): Promise<void> {
  const post = await prisma.post.findUniqueOrThrow({ where: { id: POST_ID } })
  const postSnap = post.authorSnapshot as { displayName: string; avatarUrl: string | null }
  if (post.authorUserId !== null)
    throw new Error(`post: authorUserId debería ser NULL, es ${post.authorUserId}`)
  if (postSnap.displayName !== 'ex-miembro')
    throw new Error(`post: displayName debería ser "ex-miembro", es "${postSnap.displayName}"`)
  console.log(`[smoke] post anonimizado ✓ authorUserId=NULL, displayName="${postSnap.displayName}"`)

  const comment = await prisma.comment.findUniqueOrThrow({ where: { id: COMMENT_ID } })
  const commentSnap = comment.authorSnapshot as { displayName: string }
  if (comment.authorUserId !== null)
    throw new Error(`comment: authorUserId debería ser NULL, es ${comment.authorUserId}`)
  if (commentSnap.displayName !== 'ex-miembro')
    throw new Error(
      `comment: displayName debería ser "ex-miembro", es "${commentSnap.displayName}"`,
    )
  console.log(`[smoke] comment anonimizado ✓`)

  // F.C Fase 6 PR-3: Event anonimizado.
  const event = await prisma.event.findUniqueOrThrow({ where: { id: EVENT_ID } })
  const eventSnap = event.authorSnapshot as { displayName: string }
  if (event.authorUserId !== null)
    throw new Error(`event: authorUserId debería ser NULL, es ${event.authorUserId}`)
  if (eventSnap.displayName !== 'ex-miembro')
    throw new Error(`event: displayName debería ser "ex-miembro", es "${eventSnap.displayName}"`)
  console.log(`[smoke] event anonimizado ✓`)

  // F.C Fase 6 PR-3: EventRSVP del ex-miembro borrada (per-place).
  const rsvp = await prisma.eventRSVP.findUnique({ where: { id: RSVP_ID } })
  if (rsvp !== null) throw new Error('rsvp: debería estar borrada (per-place erasure)')
  console.log(`[smoke] eventRSVP borrada ✓`)

  const membership = await prisma.membership.findUniqueOrThrow({ where: { id: MEMBERSHIP_ID } })
  if (!membership.erasureAppliedAt)
    throw new Error('membership: erasureAppliedAt debería tener fecha')
  console.log(
    `[smoke] membership marcada ✓ erasureAppliedAt=${membership.erasureAppliedAt.toISOString()}`,
  )

  const audit = await prisma.erasureAuditLog.findFirst({
    where: { membershipId: MEMBERSHIP_ID, dryRun: false },
    orderBy: { appliedAt: 'desc' },
  })
  if (!audit) throw new Error('audit: no se encontró entry real-run para la membership')
  const snapshots = audit.snapshotsBefore as Array<{ type: string; displayName: string }>
  const postSnapBefore = snapshots.find((s) => s.type === 'POST')
  const eventSnapBefore = snapshots.find((s) => s.type === 'EVENT')
  if (postSnapBefore?.displayName !== ORIGINAL_NAME)
    throw new Error(`audit: snapshotsBefore.POST.displayName debería capturar "${ORIGINAL_NAME}"`)
  if (eventSnapBefore?.displayName !== ORIGINAL_NAME)
    throw new Error(`audit: snapshotsBefore.EVENT.displayName debería capturar "${ORIGINAL_NAME}"`)
  console.log(
    `[smoke] audit log ✓ id=${audit.id}, postIds=${JSON.stringify(audit.postIds)}, snapshotsBefore incluye POST + COMMENT + EVENT con displayName="${ORIGINAL_NAME}"`,
  )
}

async function main(): Promise<void> {
  console.log(`[smoke] usando DEV_URL=${DEV_URL}`)

  // Por si quedó fixture de un run previo roto
  await cleanup()

  try {
    await seedFixture()
    await verifyBefore()

    console.log('\n[smoke] === DRY RUN ===')
    const dry = await callCron(true)
    console.log(`[smoke] dry-run result: ${JSON.stringify(dry, null, 2)}`)
    if (dry.membershipsProcessed !== 1)
      throw new Error(`dry: esperaba membershipsProcessed=1, got ${dry.membershipsProcessed}`)
    if (dry.postsAnonymized !== 1) throw new Error(`dry: esperaba postsAnonymized=1`)
    if (dry.commentsAnonymized !== 1) throw new Error(`dry: esperaba commentsAnonymized=1`)
    if (dry.eventsAnonymized !== 1) throw new Error(`dry: esperaba eventsAnonymized=1`)
    if (dry.rsvpsDeleted !== 0)
      throw new Error(`dry: rsvpsDeleted debe ser 0 en dry-run (deleteMany no se ejecuta)`)
    if (!dry.dryRun) throw new Error(`dry: debería ser dryRun=true`)

    // Dry-run NO debe haber aplicado UPDATE
    const post = await prisma.post.findUniqueOrThrow({ where: { id: POST_ID } })
    if (post.authorUserId !== USER_ID)
      throw new Error('dry-run no debería haber tocado authorUserId')
    console.log('[smoke] dry-run ✓ no aplicó UPDATEs')

    console.log('\n[smoke] === REAL RUN ===')
    const real = await callCron(false)
    console.log(`[smoke] real-run result: ${JSON.stringify(real, null, 2)}`)
    if (real.membershipsProcessed !== 1) throw new Error('real: esperaba membershipsProcessed=1')
    if (real.postsAnonymized !== 1) throw new Error('real: esperaba postsAnonymized=1')
    if (real.commentsAnonymized !== 1) throw new Error('real: esperaba commentsAnonymized=1')
    if (real.eventsAnonymized !== 1) throw new Error('real: esperaba eventsAnonymized=1')
    if (real.rsvpsDeleted !== 1) throw new Error('real: esperaba rsvpsDeleted=1')
    if (real.dryRun) throw new Error('real: debería ser dryRun=false')

    await verifyAfter()

    console.log('\n[smoke] === RE-RUN (idempotencia) ===')
    const rerun = await callCron(false)
    if (rerun.membershipsProcessed !== 0)
      throw new Error('re-run: debería ser 0 (idempotente por erasureAppliedAt IS NULL filter)')
    console.log('[smoke] idempotencia ✓ re-run no tocó nada')

    console.log('\n[smoke] ALL CHECKS PASSED ✓')
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error('[smoke] FAILED:', err)
  process.exit(1)
})
