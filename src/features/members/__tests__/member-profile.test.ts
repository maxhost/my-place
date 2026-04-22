import { describe, it, expect, vi, beforeEach } from 'vitest'

const membershipFindFirst = vi.fn()
const ownershipFindUnique = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    membership: {
      findFirst: (...a: unknown[]) => membershipFindFirst(...a),
    },
    placeOwnership: {
      findUnique: (...a: unknown[]) => ownershipFindUnique(...a),
    },
  },
}))

vi.mock('server-only', () => ({}))

import { findMemberProfile } from '../server/queries'

beforeEach(() => {
  membershipFindFirst.mockReset()
  ownershipFindUnique.mockReset()
})

describe('findMemberProfile', () => {
  it('retorna null si el userId no es miembro activo del place', async () => {
    membershipFindFirst.mockResolvedValue(null)
    ownershipFindUnique.mockResolvedValue(null)

    const res = await findMemberProfile('place-1', 'user-stranger')
    expect(res).toBeNull()
  })

  it('retorna null si la membership existe pero está cerrada (leftAt != null)', async () => {
    // El where del query filtra `leftAt: null`, así que el findFirst debe retornar null
    // directamente. Este test refuerza que no pasamos al branch de "existe".
    membershipFindFirst.mockResolvedValue(null)
    ownershipFindUnique.mockResolvedValue({ userId: 'user-1' })

    const res = await findMemberProfile('place-1', 'user-1')
    expect(res).toBeNull()
    expect(membershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ leftAt: null }),
      }),
    )
  })

  it('happy path: miembro simple sin ownership', async () => {
    membershipFindFirst.mockResolvedValue({
      id: 'mem-1',
      role: 'MEMBER',
      joinedAt: new Date('2026-01-01T00:00:00Z'),
      user: { displayName: 'Ana', handle: 'ana', avatarUrl: null },
    })
    ownershipFindUnique.mockResolvedValue(null)

    const res = await findMemberProfile('place-1', 'user-1')
    expect(res).toEqual({
      userId: 'user-1',
      membershipId: 'mem-1',
      role: 'MEMBER',
      joinedAt: new Date('2026-01-01T00:00:00Z'),
      isOwner: false,
      user: { displayName: 'Ana', handle: 'ana', avatarUrl: null },
    })
  })

  it('happy path: owner tiene isOwner=true', async () => {
    membershipFindFirst.mockResolvedValue({
      id: 'mem-2',
      role: 'ADMIN',
      joinedAt: new Date('2025-01-01T00:00:00Z'),
      user: { displayName: 'Root', handle: null, avatarUrl: 'https://example.com/a.jpg' },
    })
    ownershipFindUnique.mockResolvedValue({ userId: 'user-2' })

    const res = await findMemberProfile('place-1', 'user-2')
    expect(res?.isOwner).toBe(true)
    expect(res?.role).toBe('ADMIN')
  })

  it('multi-place: scopea por placeId (no lee membership de otro place)', async () => {
    membershipFindFirst.mockResolvedValue(null)
    ownershipFindUnique.mockResolvedValue(null)

    await findMemberProfile('place-target', 'user-1')
    expect(membershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ placeId: 'place-target', userId: 'user-1' }),
      }),
    )
    expect(ownershipFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_placeId: { userId: 'user-1', placeId: 'place-target' } },
      }),
    )
  })
})
