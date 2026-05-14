import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests de `listPendingInvitationsByPlace` con paginación + search por email
 * (2026-05-14).
 *
 * Foco:
 *  - WHERE compone placeId + acceptedAt:null + expiresAt:gt + opcional email ILIKE.
 *  - 2 queries paralelas (findMany + count), sin N+1.
 *  - Paginación: take/skip aplicados; totalCount + hasMore.
 *  - q vacío o whitespace no aplica filtro.
 *  - Mapping correcto del shape PendingInvitation.
 */

const invitationFindMany = vi.fn()
const invitationCount = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    invitation: {
      findMany: (...a: unknown[]) => invitationFindMany(...a),
      count: (...a: unknown[]) => invitationCount(...a),
    },
  },
}))

vi.mock('server-only', () => ({}))

vi.mock('@/shared/config/env', () => ({
  serverEnv: { NODE_ENV: 'test' },
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    NEXT_PUBLIC_APP_URL: 'http://lvh.me:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000',
  },
}))

import { listPendingInvitationsByPlace } from '../server/queries'

const PLACE_ID = 'place-1'

beforeEach(() => {
  invitationFindMany.mockReset()
  invitationCount.mockReset()
  invitationFindMany.mockResolvedValue([])
  invitationCount.mockResolvedValue(0)
})

describe('listPendingInvitationsByPlace — WHERE + paginación', () => {
  it('sin params: solo placeId + acceptedAt:null + expiresAt:gt (now)', async () => {
    const before = Date.now()
    await listPendingInvitationsByPlace(PLACE_ID)
    const after = Date.now()

    expect(invitationFindMany).toHaveBeenCalledTimes(1)
    expect(invitationCount).toHaveBeenCalledTimes(1)

    const call = invitationFindMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>
      orderBy: Record<string, unknown>
      take: number
      skip: number
    }
    expect(call.where.placeId).toBe(PLACE_ID)
    expect(call.where.acceptedAt).toBeNull()
    const expiresAt = call.where.expiresAt as { gt: Date }
    expect(expiresAt.gt.getTime()).toBeGreaterThanOrEqual(before)
    expect(expiresAt.gt.getTime()).toBeLessThanOrEqual(after)
    expect(call.orderBy).toEqual({ expiresAt: 'asc' })
    expect(call.take).toBe(20)
    expect(call.skip).toBe(0)
  })

  it('con q="ana": agrega filtro ILIKE sobre email', async () => {
    await listPendingInvitationsByPlace(PLACE_ID, { q: 'ana' })

    const call = invitationFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    expect(call.where.email).toEqual({ contains: 'ana', mode: 'insensitive' })
  })

  it('q vacío o whitespace no aplica filtro de email', async () => {
    await listPendingInvitationsByPlace(PLACE_ID, { q: '   ' })

    const call = invitationFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    expect(call.where.email).toBeUndefined()
  })

  it('page=2 limit=10 → skip=10, take=10', async () => {
    await listPendingInvitationsByPlace(PLACE_ID, { page: 2, limit: 10 })

    const call = invitationFindMany.mock.calls[0]?.[0] as { take: number; skip: number }
    expect(call.take).toBe(10)
    expect(call.skip).toBe(10)
  })

  it('limit clamp: 200 → 50 (cap)', async () => {
    await listPendingInvitationsByPlace(PLACE_ID, { limit: 200 })

    const call = invitationFindMany.mock.calls[0]?.[0] as { take: number }
    expect(call.take).toBe(50)
  })

  it('page clamp: page=0 → 1 (skip=0)', async () => {
    await listPendingInvitationsByPlace(PLACE_ID, { page: 0 })

    const call = invitationFindMany.mock.calls[0]?.[0] as { skip: number }
    expect(call.skip).toBe(0)
  })

  it('inyecta `now` para tests deterministas', async () => {
    const fixedNow = new Date('2026-05-14T10:00:00Z')
    await listPendingInvitationsByPlace(PLACE_ID, { now: fixedNow })

    const call = invitationFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    const expiresAt = call.where.expiresAt as { gt: Date }
    expect(expiresAt.gt).toBe(fixedNow)
  })

  it('count usa MISMO where que findMany', async () => {
    await listPendingInvitationsByPlace(PLACE_ID, { q: 'ana' })

    const findCall = invitationFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    const countCall = invitationCount.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    expect(countCall.where).toEqual(findCall.where)
  })
})

describe('listPendingInvitationsByPlace — shape del resultado', () => {
  it('mapea cada row a PendingInvitation con inviter', async () => {
    invitationFindMany.mockResolvedValue([
      {
        id: 'inv-1',
        placeId: PLACE_ID,
        email: 'ana@example.com',
        invitedBy: 'user-1',
        asAdmin: false,
        asOwner: false,
        acceptedAt: null,
        expiresAt: new Date('2026-06-01T00:00:00Z'),
        token: 'tok-1',
        deliveryStatus: 'SENT',
        providerMessageId: 'msg-1',
        lastDeliveryError: null,
        lastSentAt: new Date('2026-05-10T00:00:00Z'),
        inviter: { displayName: 'Max' },
      },
    ])
    invitationCount.mockResolvedValue(1)

    const result = await listPendingInvitationsByPlace(PLACE_ID)

    expect(result.totalCount).toBe(1)
    expect(result.hasMore).toBe(false)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      id: 'inv-1',
      email: 'ana@example.com',
      asAdmin: false,
      asOwner: false,
      deliveryStatus: 'SENT',
      inviter: { displayName: 'Max' },
    })
  })

  it('empty: rows=[], totalCount=0, hasMore=false', async () => {
    invitationFindMany.mockResolvedValue([])
    invitationCount.mockResolvedValue(0)
    const result = await listPendingInvitationsByPlace(PLACE_ID)
    expect(result).toEqual({ rows: [], totalCount: 0, hasMore: false })
  })

  it('hasMore=true cuando totalCount > skip+rows.length', async () => {
    invitationFindMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: `inv-${i}`,
        placeId: PLACE_ID,
        email: `u${i}@x.com`,
        invitedBy: 'user-1',
        asAdmin: false,
        asOwner: false,
        acceptedAt: null,
        expiresAt: new Date(),
        token: `tok-${i}`,
        deliveryStatus: 'SENT',
        providerMessageId: null,
        lastDeliveryError: null,
        lastSentAt: null,
        inviter: { displayName: 'X' },
      })),
    )
    invitationCount.mockResolvedValue(45)

    const result = await listPendingInvitationsByPlace(PLACE_ID, { page: 1, limit: 20 })
    expect(result.hasMore).toBe(true)
    expect(result.totalCount).toBe(45)
  })
})
