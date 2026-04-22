import { describe, it, expect, vi, beforeEach } from 'vitest'

const membershipFindMany = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    membership: { findMany: (...args: unknown[]) => membershipFindMany(...args) },
  },
}))

vi.mock('server-only', () => ({}))

import { listMyPlaces } from '../server/queries'

const base = {
  id: 'p',
  slug: 's',
  name: 'n',
  description: null,
  billingMode: 'OWNER_PAYS',
  archivedAt: null,
  createdAt: new Date('2026-01-01'),
}

function membershipRow(opts: {
  role: 'MEMBER' | 'ADMIN'
  joinedAt?: Date
  place: { id: string; slug: string; archivedAt?: Date | null; ownerships: { userId: string }[] }
}) {
  return {
    role: opts.role,
    joinedAt: opts.joinedAt ?? new Date('2026-01-02'),
    place: {
      ...base,
      ...opts.place,
      archivedAt: opts.place.archivedAt ?? null,
    },
  }
}

beforeEach(() => {
  membershipFindMany.mockReset()
})

describe('listMyPlaces', () => {
  it('retorna vacío si el usuario no tiene memberships', async () => {
    membershipFindMany.mockResolvedValue([])
    expect(await listMyPlaces('user-1')).toEqual([])
  })

  it('filtra por userId + leftAt null + no archivados por default', async () => {
    membershipFindMany.mockResolvedValue([])
    await listMyPlaces('user-1')

    const callArgs = membershipFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    expect(callArgs.where).toMatchObject({
      userId: 'user-1',
      leftAt: null,
      place: { archivedAt: null },
    })
  })

  it('includeArchived=true no filtra archivedAt', async () => {
    membershipFindMany.mockResolvedValue([])
    await listMyPlaces('user-1', { includeArchived: true })

    const callArgs = membershipFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    expect(callArgs.where).toMatchObject({ userId: 'user-1', leftAt: null })
    expect(callArgs.where.place).toBeUndefined()
  })

  it('marca isOwner=true cuando existe PlaceOwnership del user en ese place', async () => {
    membershipFindMany.mockResolvedValue([
      membershipRow({
        role: 'ADMIN',
        place: { id: 'p1', slug: 'owned', ownerships: [{ userId: 'u' }] },
      }),
      membershipRow({
        role: 'MEMBER',
        place: { id: 'p2', slug: 'just-member', ownerships: [] },
      }),
    ])

    const out = await listMyPlaces('u')
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ id: 'p1', slug: 'owned', role: 'ADMIN', isOwner: true })
    expect(out[1]).toMatchObject({ id: 'p2', slug: 'just-member', role: 'MEMBER', isOwner: false })
  })

  it('multi-place: user owner de 2 + miembro simple de 3 → 5 resultados, flags correctos', async () => {
    const rows = [
      membershipRow({
        role: 'ADMIN',
        place: { id: 'a', slug: 'owned-a', ownerships: [{ userId: 'u' }] },
      }),
      membershipRow({
        role: 'ADMIN',
        place: { id: 'b', slug: 'owned-b', ownerships: [{ userId: 'u' }] },
      }),
      membershipRow({ role: 'MEMBER', place: { id: 'c', slug: 'mem-c', ownerships: [] } }),
      membershipRow({ role: 'MEMBER', place: { id: 'd', slug: 'mem-d', ownerships: [] } }),
      membershipRow({ role: 'MEMBER', place: { id: 'e', slug: 'mem-e', ownerships: [] } }),
    ]
    membershipFindMany.mockResolvedValue(rows)

    const out = await listMyPlaces('u')
    expect(out).toHaveLength(5)
    const owners = out.filter((p) => p.isOwner).map((p) => p.slug)
    const members = out.filter((p) => !p.isOwner).map((p) => p.slug)
    expect(owners.sort()).toEqual(['owned-a', 'owned-b'])
    expect(members.sort()).toEqual(['mem-c', 'mem-d', 'mem-e'])
  })

  it('ownerships del include restringe por userId (no devuelve owners de otros)', async () => {
    membershipFindMany.mockResolvedValue([])
    await listMyPlaces('u')
    const callArgs = membershipFindMany.mock.calls[0]?.[0] as {
      include: { place: { include: { ownerships: { where: unknown } } } }
    }
    expect(callArgs.include.place.include.ownerships.where).toEqual({ userId: 'u' })
  })
})
