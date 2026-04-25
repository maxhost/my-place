import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  membershipFindMany,
  postFindMany,
  commentFindMany,
  eventFindMany,
  eventRsvpDeleteMany,
  erasureAuditCreate,
  membershipUpdate,
  postExecuteRaw,
  commentExecuteRaw,
  eventExecuteRaw,
  advisoryLockQueryRaw,
  transactionFn,
  loggerWarn,
  loggerInfo,
  loggerError,
} = vi.hoisted(() => ({
  membershipFindMany: vi.fn(),
  postFindMany: vi.fn(),
  commentFindMany: vi.fn(),
  eventFindMany: vi.fn(),
  eventRsvpDeleteMany: vi.fn(),
  erasureAuditCreate: vi.fn(),
  membershipUpdate: vi.fn(),
  postExecuteRaw: vi.fn(),
  commentExecuteRaw: vi.fn(),
  eventExecuteRaw: vi.fn(),
  advisoryLockQueryRaw: vi.fn(),
  transactionFn: vi.fn(),
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/db/client', () => ({
  prisma: {
    membership: {
      findMany: (...a: unknown[]) => membershipFindMany(...a),
      update: (...a: unknown[]) => membershipUpdate(...a),
    },
    post: { findMany: (...a: unknown[]) => postFindMany(...a) },
    comment: { findMany: (...a: unknown[]) => commentFindMany(...a) },
    event: { findMany: (...a: unknown[]) => eventFindMany(...a) },
    eventRSVP: { deleteMany: (...a: unknown[]) => eventRsvpDeleteMany(...a) },
    erasureAuditLog: { create: (...a: unknown[]) => erasureAuditCreate(...a) },
    $queryRaw: (...a: unknown[]) => advisoryLockQueryRaw(...a),
    $transaction: (fn: (tx: unknown) => unknown) => transactionFn(fn),
  },
}))

vi.mock('@/shared/lib/logger', () => ({
  logger: { warn: loggerWarn, info: loggerInfo, error: loggerError, debug: vi.fn() },
}))

import { runErasure } from '../run-erasure'

const NOW = new Date('2027-04-24T00:00:00Z')
const CUTOFF_365D_AGO = new Date('2026-04-24T00:00:00Z') // exactamente 365d
const LEFT_AT_366D_AGO = new Date('2026-04-23T00:00:00Z') // elegible
// Boundary/safety coverage vive en el test de query eligible (usa where:
// leftAt.lt y leftAt.gt). Los helpers LEFT_AT_364D_AGO y LEFT_AT_11_YEARS_AGO
// no se necesitan como fixtures — se validan por los bounds del query.

const eligibleMembership = {
  id: 'mem-1',
  userId: 'user-1',
  placeId: 'place-1',
  leftAt: LEFT_AT_366D_AGO,
}

function sqlText(arg: unknown): string {
  // Prisma.sql devuelve un objeto Sql con .text, mientras que $queryRaw
  // también acepta TemplateStringsArray. Detectamos ambos.
  if (arg && typeof arg === 'object' && 'text' in arg && typeof arg.text === 'string') {
    return arg.text
  }
  if (Array.isArray(arg)) {
    return arg.join('')
  }
  return String(arg)
}

function setupLockAcquired() {
  advisoryLockQueryRaw.mockImplementation(async (arg: unknown) => {
    const text = sqlText(arg)
    if (text.includes('pg_try_advisory_lock')) return [{ locked: true }]
    if (text.includes('pg_advisory_unlock')) return []
    return []
  })
}

function setupTransactionPassthrough() {
  transactionFn.mockImplementation(async (cb: (tx: unknown) => unknown) => {
    return cb({
      post: { findMany: postFindMany },
      comment: { findMany: commentFindMany },
      event: { findMany: eventFindMany },
      eventRSVP: { deleteMany: eventRsvpDeleteMany },
      erasureAuditLog: { create: erasureAuditCreate },
      membership: { update: membershipUpdate },
      $executeRaw: (arg: unknown, ...vals: unknown[]) => {
        const text = sqlText(arg)
        if (text.includes('"Post"')) return postExecuteRaw(text, ...vals)
        if (text.includes('"Comment"')) return commentExecuteRaw(text, ...vals)
        if (text.includes('"Event"')) return eventExecuteRaw(text, ...vals)
        return 0
      },
    })
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  setupLockAcquired()
  setupTransactionPassthrough()
  postFindMany.mockResolvedValue([])
  commentFindMany.mockResolvedValue([])
  eventFindMany.mockResolvedValue([])
  eventRsvpDeleteMany.mockResolvedValue({ count: 0 })
  postExecuteRaw.mockResolvedValue(0)
  commentExecuteRaw.mockResolvedValue(0)
  eventExecuteRaw.mockResolvedValue(0)
  erasureAuditCreate.mockResolvedValue({ id: 'audit-1' })
  membershipUpdate.mockResolvedValue({ id: 'mem-1' })
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('runErasure', () => {
  it('sin membresías elegibles: counts en 0 y no toca ninguna tabla', async () => {
    membershipFindMany.mockResolvedValue([])

    const result = await runErasure({ dryRun: false, now: NOW })

    expect(result).toMatchObject({
      dryRun: false,
      membershipsProcessed: 0,
      postsAnonymized: 0,
      commentsAnonymized: 0,
      eventsAnonymized: 0,
      rsvpsDeleted: 0,
      errorsPerMembership: [],
    })
    expect(transactionFn).not.toHaveBeenCalled()
  })

  it('membership elegible con 2 posts + 3 comments: audit + UPDATE + marca erasureAppliedAt', async () => {
    membershipFindMany.mockResolvedValue([eligibleMembership])
    postFindMany.mockResolvedValue([
      { id: 'p1', authorSnapshot: { displayName: 'Alice', avatarUrl: null } },
      { id: 'p2', authorSnapshot: { displayName: 'Alice', avatarUrl: 'https://x/a.png' } },
    ])
    commentFindMany.mockResolvedValue([
      { id: 'c1', authorSnapshot: { displayName: 'Alice', avatarUrl: null } },
      { id: 'c2', authorSnapshot: { displayName: 'Alice', avatarUrl: null } },
      { id: 'c3', authorSnapshot: { displayName: 'Alice', avatarUrl: null } },
    ])

    const result = await runErasure({ dryRun: false, now: NOW })

    expect(result.membershipsProcessed).toBe(1)
    expect(result.postsAnonymized).toBe(2)
    expect(result.commentsAnonymized).toBe(3)

    expect(erasureAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        membershipId: 'mem-1',
        userId: 'user-1',
        placeId: 'place-1',
        postIds: ['p1', 'p2'],
        commentIds: ['c1', 'c2', 'c3'],
        dryRun: false,
      }),
    })
    expect(postExecuteRaw).toHaveBeenCalled()
    expect(commentExecuteRaw).toHaveBeenCalled()
    expect(membershipUpdate).toHaveBeenCalledWith({
      where: { id: 'mem-1' },
      data: { erasureAppliedAt: NOW },
    })
  })

  it('query eligible filtra cutoff 365d + safety threshold 10y + place no archivado + sin erasureAppliedAt', async () => {
    membershipFindMany.mockResolvedValue([])

    await runErasure({ dryRun: false, now: NOW })

    expect(membershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          leftAt: expect.objectContaining({
            lt: expect.any(Date),
            gt: expect.any(Date),
          }),
          erasureAppliedAt: null,
          place: { archivedAt: null },
        }),
        take: 500,
      }),
    )
    const callArgs = membershipFindMany.mock.calls[0]![0] as {
      where: { leftAt: { lt: Date; gt: Date } }
    }
    // cutoff = now - 365d
    expect(callArgs.where.leftAt.lt.getTime()).toBeCloseTo(CUTOFF_365D_AGO.getTime(), -3)
    // safetyFloor = now - 10 años (diferencia ~10x más grande que 365d)
    const safetyFloor = callArgs.where.leftAt.gt
    expect(NOW.getTime() - safetyFloor.getTime()).toBeGreaterThan(9 * 365 * 24 * 60 * 60 * 1000)
  })

  it('multiple memberships: cada una en tx separada', async () => {
    const m2 = { ...eligibleMembership, id: 'mem-2', userId: 'user-2' }
    const m3 = { ...eligibleMembership, id: 'mem-3', userId: 'user-3' }
    membershipFindMany.mockResolvedValue([eligibleMembership, m2, m3])

    await runErasure({ dryRun: false, now: NOW })

    expect(transactionFn).toHaveBeenCalledTimes(3)
  })

  it('error en una membership no aborta las demás: error isolation', async () => {
    const m2 = { ...eligibleMembership, id: 'mem-2', userId: 'user-2' }
    membershipFindMany.mockResolvedValue([eligibleMembership, m2])

    let callCount = 0
    transactionFn.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      callCount += 1
      if (callCount === 1) throw new Error('db deadlock')
      return cb({
        post: { findMany: postFindMany },
        comment: { findMany: commentFindMany },
        event: { findMany: eventFindMany },
        eventRSVP: { deleteMany: eventRsvpDeleteMany },
        erasureAuditLog: { create: erasureAuditCreate },
        membership: { update: membershipUpdate },
        $executeRaw: () => 0,
      })
    })

    const result = await runErasure({ dryRun: false, now: NOW })

    expect(result.errorsPerMembership).toEqual([
      { membershipId: 'mem-1', error: expect.stringContaining('deadlock') },
    ])
    expect(result.membershipsProcessed).toBe(1)
    expect(loggerError).toHaveBeenCalled()
  })

  it('dryRun=true: captura snapshots pero no ejecuta UPDATE ni marca erasureAppliedAt', async () => {
    membershipFindMany.mockResolvedValue([eligibleMembership])
    postFindMany.mockResolvedValue([
      { id: 'p1', authorSnapshot: { displayName: 'Alice', avatarUrl: null } },
    ])
    commentFindMany.mockResolvedValue([])

    const result = await runErasure({ dryRun: true, now: NOW })

    expect(result.dryRun).toBe(true)
    expect(result.membershipsProcessed).toBe(1)
    expect(result.postsAnonymized).toBe(1)
    // Audit SÍ se intenta insertar pero la tx rollbackea — el caller no ve
    // UPDATEs aplicados a Post/Comment, ni membership marcada.
    expect(postExecuteRaw).not.toHaveBeenCalled()
    expect(commentExecuteRaw).not.toHaveBeenCalled()
    expect(membershipUpdate).not.toHaveBeenCalled()
  })

  it('advisory lock: si otro worker tiene el lock, retorna noop sin procesar', async () => {
    advisoryLockQueryRaw.mockImplementation(async (arg: unknown) => {
      const text = sqlText(arg)
      if (text.includes('pg_try_advisory_lock')) return [{ locked: false }]
      return []
    })

    const result = await runErasure({ dryRun: false, now: NOW })

    expect(result.membershipsProcessed).toBe(0)
    expect(membershipFindMany).not.toHaveBeenCalled()
    expect(transactionFn).not.toHaveBeenCalled()
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'erasureLockContention' }),
      expect.any(String),
    )
  })

  it('advisory lock se libera aun si la query eligible falla', async () => {
    membershipFindMany.mockRejectedValue(new Error('prisma down'))

    await expect(runErasure({ dryRun: false, now: NOW })).rejects.toThrow('prisma down')

    const unlockCall = advisoryLockQueryRaw.mock.calls.find((call) =>
      sqlText(call[0]).includes('pg_advisory_unlock'),
    )
    expect(unlockCall).toBeDefined()
  })

  it('snapshotsBefore en audit incluye type + id + displayName + avatarUrl de Post, Comment y Event', async () => {
    membershipFindMany.mockResolvedValue([eligibleMembership])
    postFindMany.mockResolvedValue([
      { id: 'p1', authorSnapshot: { displayName: 'Alice', avatarUrl: 'https://x/a.png' } },
    ])
    commentFindMany.mockResolvedValue([
      { id: 'c1', authorSnapshot: { displayName: 'Alice', avatarUrl: null } },
    ])
    eventFindMany.mockResolvedValue([
      { id: 'e1', authorSnapshot: { displayName: 'Alice', avatarUrl: null } },
    ])

    await runErasure({ dryRun: false, now: NOW })

    const auditArg = erasureAuditCreate.mock.calls[0]![0] as {
      data: { snapshotsBefore: unknown }
    }
    expect(auditArg.data.snapshotsBefore).toEqual([
      { type: 'POST', id: 'p1', displayName: 'Alice', avatarUrl: 'https://x/a.png' },
      { type: 'COMMENT', id: 'c1', displayName: 'Alice', avatarUrl: null },
      { type: 'EVENT', id: 'e1', displayName: 'Alice', avatarUrl: null },
    ])
  })

  // ── F.C Fase 6 (PR-3): Event + EventRSVP per-place ────────────────────

  it('PR-3: Event del ex-miembro queda anonimizado (UPDATE Event en la 3ª raw SQL)', async () => {
    membershipFindMany.mockResolvedValue([eligibleMembership])
    eventFindMany.mockResolvedValue([
      { id: 'e1', authorSnapshot: { displayName: 'Alice', avatarUrl: null } },
      { id: 'e2', authorSnapshot: { displayName: 'Alice', avatarUrl: null } },
    ])

    const result = await runErasure({ dryRun: false, now: NOW })

    expect(result.eventsAnonymized).toBe(2)
    expect(eventExecuteRaw).toHaveBeenCalledTimes(1)
    const sqlCalled = eventExecuteRaw.mock.calls[0]![0] as string
    expect(sqlCalled).toMatch(/UPDATE "Event"/)
    expect(sqlCalled).toMatch(/jsonb_set/)
  })

  it('PR-3: RSVPs del ex-miembro borradas en el place que dejó (filtro nested event.placeId)', async () => {
    membershipFindMany.mockResolvedValue([eligibleMembership])
    eventRsvpDeleteMany.mockResolvedValue({ count: 5 })

    const result = await runErasure({ dryRun: false, now: NOW })

    expect(result.rsvpsDeleted).toBe(5)
    expect(eventRsvpDeleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        event: { placeId: 'place-1' },
      },
    })
  })

  it('PR-3: el filtro nested event.placeId asegura que NO borra RSVPs en otros places (scope per-place)', async () => {
    // Validamos por contrato del where: el filtro siempre incluye
    // `event: { placeId }`. Si un futuro refactor lo elimina, este test rompe.
    membershipFindMany.mockResolvedValue([eligibleMembership])
    eventRsvpDeleteMany.mockResolvedValue({ count: 1 })

    await runErasure({ dryRun: false, now: NOW })

    const callArgs = eventRsvpDeleteMany.mock.calls[0]![0] as {
      where: { userId: string; event?: { placeId?: string } }
    }
    expect(callArgs.where.userId).toBe('user-1')
    // CRÍTICO: el filtro DEBE incluir event.placeId. Sin esto, el deleteMany
    // sería global y borraría RSVPs en todos los places donde el user
    // sigue activo.
    expect(callArgs.where.event).toEqual({ placeId: 'place-1' })
  })
})
