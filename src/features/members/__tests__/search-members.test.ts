import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests de `searchMembers` (M.3 + paginación 2026-05-14).
 *
 * Foco:
 *  - WHERE compuesto correcto según `MemberSearchParams`.
 *  - 4 queries paralelas (findMany + count + ownerships + preset memberships).
 *    Sin N+1 — `_count.tierMemberships` viaja en el SELECT.
 *  - Paginación: take/skip aplicados, totalCount + hasMore calculados.
 *  - Mapping correcto de `tierCount` desde `_count.tierMemberships`.
 *  - Filtro `q` aplica `OR` sobre `displayName` y `handle` con
 *    `mode: 'insensitive'`.
 *  - Filtro `joinedSince` calcula `gte` correcto para 7d/30d/90d/1y.
 */

const membershipFindMany = vi.fn()
const membershipCount = vi.fn()
const ownershipFindMany = vi.fn()
// C.1: `searchMembers` agrega 3ra query a `groupMembership.findMany` para
// derivar `isAdmin`. Default = `[]` (ningún miembro es admin).
const groupMembershipFindMany = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    membership: {
      findMany: (...a: unknown[]) => membershipFindMany(...a),
      count: (...a: unknown[]) => membershipCount(...a),
    },
    placeOwnership: {
      findMany: (...a: unknown[]) => ownershipFindMany(...a),
    },
    groupMembership: {
      findMany: (...a: unknown[]) => groupMembershipFindMany(...a),
    },
  },
}))

vi.mock('server-only', () => ({}))

// La cadena de imports de queries.ts atraviesa supabase/server (vía
// re-exports de tests adyacentes en la misma suite). Mock del env
// previene parse eager de Zod sobre process.env vacío en CI/test.
vi.mock('@/shared/config/env', () => ({
  serverEnv: { NODE_ENV: 'test' },
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    NEXT_PUBLIC_APP_URL: 'http://lvh.me:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000',
  },
}))

import { searchMembers } from '../directory/server/directory-queries'

const PLACE_ID = 'place-1'

beforeEach(() => {
  membershipFindMany.mockReset()
  membershipCount.mockReset()
  ownershipFindMany.mockReset()
  groupMembershipFindMany.mockReset()
  membershipFindMany.mockResolvedValue([])
  membershipCount.mockResolvedValue(0)
  ownershipFindMany.mockResolvedValue([])
  groupMembershipFindMany.mockResolvedValue([])
})

describe('searchMembers — query shape', () => {
  it('sin params: filtra solo placeId + leftAt:null y ordena por joinedAt asc', async () => {
    await searchMembers(PLACE_ID, {})

    expect(membershipFindMany).toHaveBeenCalledTimes(1)
    expect(membershipCount).toHaveBeenCalledTimes(1)
    expect(ownershipFindMany).toHaveBeenCalledTimes(1)
    expect(groupMembershipFindMany).toHaveBeenCalledTimes(1)

    const call = membershipFindMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>
      orderBy: Record<string, unknown>
      take: number
      skip: number
    }
    expect(call.where).toEqual({ placeId: PLACE_ID, leftAt: null })
    expect(call.orderBy).toEqual({ joinedAt: 'asc' })
    // Default limit=20, page=1 → take=20, skip=0.
    expect(call.take).toBe(20)
    expect(call.skip).toBe(0)

    // count usa MISMO where que findMany (sin take/skip/orderBy).
    const countCall = membershipCount.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    expect(countCall.where).toEqual({ placeId: PLACE_ID, leftAt: null })
  })

  it('con q: agrega OR sobre displayName y handle con mode insensitive', async () => {
    await searchMembers(PLACE_ID, { q: 'ana' })

    const call = membershipFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    expect(call.where).toMatchObject({
      placeId: PLACE_ID,
      leftAt: null,
      user: {
        OR: [
          { displayName: { contains: 'ana', mode: 'insensitive' } },
          { handle: { contains: 'ana', mode: 'insensitive' } },
        ],
      },
    })
  })

  it('q vacío o solo whitespace no aplica filtro', async () => {
    await searchMembers(PLACE_ID, { q: '   ' })

    const call = membershipFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    expect(call.where).toEqual({ placeId: PLACE_ID, leftAt: null })
  })

  it('con groupId: filtra por user con membership a ese permission group del place', async () => {
    await searchMembers(PLACE_ID, { groupId: 'grp-mods' })

    const call = membershipFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    const userWhere = call.where.user as {
      groupMemberships: { some: { placeId: string; groupId: string } }
    }
    expect(userWhere.groupMemberships).toEqual({
      some: { placeId: PLACE_ID, groupId: 'grp-mods' },
    })
  })

  it('con groupId del preset Administradores: filtra members del preset (admins)', async () => {
    // Admin se modela como membership al preset; el dropdown del filtro
    // expone "Administradores" como groupId más. Sin OR especial — basta
    // el match plano por groupId. Esto reemplaza el legacy `isAdmin`.
    await searchMembers(PLACE_ID, { groupId: 'grp-preset-admins' })

    const call = membershipFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    const userWhere = call.where.user as {
      groupMemberships: { some: { placeId: string; groupId: string } }
    }
    expect(userWhere.groupMemberships.some.groupId).toBe('grp-preset-admins')
  })

  it('con tierId: filtra users con asignación activa al tier (expiresAt null o futura)', async () => {
    await searchMembers(PLACE_ID, { tierId: 'tier-x' })

    const call = membershipFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    const userWhere = (call.where.user as Record<string, unknown>) ?? {}
    const tmFilter = userWhere.tierMemberships as { some: Record<string, unknown> }
    expect(tmFilter.some.tierId).toBe('tier-x')
    expect(tmFilter.some.OR).toEqual([
      { expiresAt: null },
      expect.objectContaining({ expiresAt: expect.objectContaining({ gt: expect.any(Date) }) }),
    ])
  })

  it('con joinedSince=7d: calcula gte = now - 7 días', async () => {
    const before = Date.now()
    await searchMembers(PLACE_ID, { joinedSince: '7d' })
    const after = Date.now()

    const call = membershipFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    const joinedAt = call.where.joinedAt as { gte: Date }
    expect(joinedAt.gte).toBeInstanceOf(Date)
    const expectedMin = before - 7 * 24 * 60 * 60 * 1000
    const expectedMax = after - 7 * 24 * 60 * 60 * 1000
    expect(joinedAt.gte.getTime()).toBeGreaterThanOrEqual(expectedMin)
    expect(joinedAt.gte.getTime()).toBeLessThanOrEqual(expectedMax)
  })

  it.each([
    ['7d' as const, 7],
    ['30d' as const, 30],
    ['90d' as const, 90],
    ['1y' as const, 365],
  ])('joinedSince=%s mapea a %i días', async (joinedSince, days) => {
    const before = Date.now()
    await searchMembers(PLACE_ID, { joinedSince })
    const call = membershipFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    const joinedAt = call.where.joinedAt as { gte: Date }
    const delta = before - joinedAt.gte.getTime()
    // Tolerancia de unos pocos ms entre `before` y la lectura interna de Date.now().
    const expected = days * 24 * 60 * 60 * 1000
    expect(Math.abs(delta - expected)).toBeLessThan(1000)
  })

  it('combinación de todos los filtros en un solo WHERE compuesto', async () => {
    await searchMembers(PLACE_ID, {
      q: 'maxi',
      groupId: 'grp-mods',
      tierId: 'tier-premium',
      joinedSince: '30d',
    })

    const call = membershipFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    expect(call.where.placeId).toBe(PLACE_ID)
    expect(call.where.leftAt).toBeNull()
    expect(call.where.joinedAt).toMatchObject({ gte: expect.any(Date) })

    const userWhere = call.where.user as Record<string, unknown>
    // `q` aporta `OR` sobre displayName/handle.
    expect(userWhere.OR).toEqual([
      { displayName: { contains: 'maxi', mode: 'insensitive' } },
      { handle: { contains: 'maxi', mode: 'insensitive' } },
    ])
    const tmFilter = userWhere.tierMemberships as { some: Record<string, unknown> }
    expect(tmFilter.some.tierId).toBe('tier-premium')
    // groupId aporta el match plano `groupMemberships.some({ placeId, groupId })`.
    const gmFilter = userWhere.groupMemberships as {
      some: { placeId: string; groupId: string }
    }
    expect(gmFilter.some).toEqual({ placeId: PLACE_ID, groupId: 'grp-mods' })
  })

  it('include trae user (displayName, handle, avatarUrl) + _count.tierMemberships scopeado al placeId', async () => {
    await searchMembers(PLACE_ID, {})

    const call = membershipFindMany.mock.calls[0]?.[0] as { include: Record<string, unknown> }
    const userInclude = call.include.user as { select: Record<string, unknown> }
    expect(userInclude.select.displayName).toBe(true)
    expect(userInclude.select.handle).toBe(true)
    expect(userInclude.select.avatarUrl).toBe(true)
    expect(userInclude.select.email).toBeUndefined() // privacidad

    const count = userInclude.select._count as { select: Record<string, unknown> }
    const tierMembershipsCount = count.select.tierMemberships as { where: Record<string, unknown> }
    expect(tierMembershipsCount.where).toEqual({ placeId: PLACE_ID })
  })
})

describe('searchMembers — mapping del resultado', () => {
  it('mapea cada membership a MemberSummary con isOwner derivado y tierCount', async () => {
    membershipFindMany.mockResolvedValue([
      {
        id: 'mem-1',
        userId: 'user-owner',
        joinedAt: new Date('2025-01-01T00:00:00Z'),
        user: {
          displayName: 'Root',
          handle: 'root',
          avatarUrl: null,
          _count: { tierMemberships: 2 },
        },
      },
      {
        id: 'mem-2',
        userId: 'user-other',
        joinedAt: new Date('2026-04-01T00:00:00Z'),
        user: {
          displayName: 'Ana',
          handle: null,
          avatarUrl: 'https://x/y.jpg',
          _count: { tierMemberships: 0 },
        },
      },
    ])
    membershipCount.mockResolvedValue(2)
    ownershipFindMany.mockResolvedValue([{ userId: 'user-owner' }])

    const result = await searchMembers(PLACE_ID, {})

    expect(result.totalCount).toBe(2)
    expect(result.hasMore).toBe(false)
    expect(result.rows).toEqual([
      {
        userId: 'user-owner',
        membershipId: 'mem-1',
        joinedAt: new Date('2025-01-01T00:00:00Z'),
        isOwner: true,
        // C.1: isOwner ⇒ isAdmin (owner es dios implícito).
        isAdmin: true,
        user: { displayName: 'Root', handle: 'root', avatarUrl: null },
        tierCount: 2,
      },
      {
        userId: 'user-other',
        membershipId: 'mem-2',
        joinedAt: new Date('2026-04-01T00:00:00Z'),
        isOwner: false,
        // C.1: sin membership al preset group + no owner ⇒ isAdmin=false.
        isAdmin: false,
        user: { displayName: 'Ana', handle: null, avatarUrl: 'https://x/y.jpg' },
        tierCount: 0,
      },
    ])
  })

  it('lista vacía si no hay miembros', async () => {
    membershipFindMany.mockResolvedValue([])
    membershipCount.mockResolvedValue(0)
    ownershipFindMany.mockResolvedValue([])
    const result = await searchMembers(PLACE_ID, {})
    expect(result).toEqual({ rows: [], totalCount: 0, hasMore: false })
  })
})

describe('searchMembers — paginación', () => {
  it('page=2 limit=10 → skip=10, take=10', async () => {
    await searchMembers(PLACE_ID, { page: 2, limit: 10 })

    const call = membershipFindMany.mock.calls[0]?.[0] as { take: number; skip: number }
    expect(call.take).toBe(10)
    expect(call.skip).toBe(10)
  })

  it('limit clamp: limit=200 → 50 (cap)', async () => {
    await searchMembers(PLACE_ID, { limit: 200 })

    const call = membershipFindMany.mock.calls[0]?.[0] as { take: number }
    expect(call.take).toBe(50)
  })

  it('page clamp: page=0 → page=1 (skip=0)', async () => {
    await searchMembers(PLACE_ID, { page: 0 })

    const call = membershipFindMany.mock.calls[0]?.[0] as { skip: number }
    expect(call.skip).toBe(0)
  })

  it('limit no entero: limit=10.7 → 10 (floor)', async () => {
    await searchMembers(PLACE_ID, { limit: 10.7 })

    const call = membershipFindMany.mock.calls[0]?.[0] as { take: number }
    expect(call.take).toBe(10)
  })

  it('hasMore=true cuando totalCount > skip + rows.length', async () => {
    membershipFindMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: `mem-${i}`,
        userId: `user-${i}`,
        joinedAt: new Date(),
        user: {
          displayName: `U${i}`,
          handle: null,
          avatarUrl: null,
          _count: { tierMemberships: 0 },
        },
      })),
    )
    membershipCount.mockResolvedValue(45)
    ownershipFindMany.mockResolvedValue([])

    const result = await searchMembers(PLACE_ID, { page: 1, limit: 20 })

    expect(result.totalCount).toBe(45)
    expect(result.rows).toHaveLength(20)
    expect(result.hasMore).toBe(true)
  })

  it('hasMore=false en última page', async () => {
    membershipFindMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `mem-${i}`,
        userId: `user-${i}`,
        joinedAt: new Date(),
        user: {
          displayName: `U${i}`,
          handle: null,
          avatarUrl: null,
          _count: { tierMemberships: 0 },
        },
      })),
    )
    membershipCount.mockResolvedValue(25)
    ownershipFindMany.mockResolvedValue([])

    // page=2 limit=20 → skip=20, rows=5 → 20+5=25=totalCount → hasMore=false
    const result = await searchMembers(PLACE_ID, { page: 2, limit: 20 })
    expect(result.hasMore).toBe(false)
  })
})
