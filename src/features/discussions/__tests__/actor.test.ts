import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MembershipRole } from '@prisma/client'
import { AuthorizationError, NotFoundError } from '@/shared/errors/domain-error'

const placeFindUnique = vi.fn()
const membershipFindFirst = vi.fn()
const ownershipFindUnique = vi.fn()
const userFindUnique = vi.fn()
const getUserFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
    membership: { findFirst: (...a: unknown[]) => membershipFindFirst(...a) },
    placeOwnership: { findUnique: (...a: unknown[]) => ownershipFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
  },
}))

vi.mock('@/shared/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: getUserFn } }),
}))

vi.mock('server-only', () => ({}))

import { resolveActorForPlace } from '../server/actor'

const AUTH_OK = { data: { user: { id: 'user-1' } } }

beforeEach(() => {
  placeFindUnique.mockReset()
  membershipFindFirst.mockReset()
  ownershipFindUnique.mockReset()
  userFindUnique.mockReset()
  getUserFn.mockReset()
})

describe('resolveActorForPlace', () => {
  it('AuthorizationError si no hay sesión', async () => {
    getUserFn.mockResolvedValue({ data: { user: null } })
    await expect(resolveActorForPlace({ placeId: 'p-1' })).rejects.toBeInstanceOf(
      AuthorizationError,
    )
  })

  it('NotFoundError si no se pasa placeSlug ni placeId', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    await expect(resolveActorForPlace({})).rejects.toBeInstanceOf(NotFoundError)
  })

  it('NotFoundError si el place está archivado', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue({
      id: 'p-1',
      slug: 's',
      archivedAt: new Date(),
    })
    await expect(resolveActorForPlace({ placeId: 'p-1' })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('AuthorizationError si el user no es miembro activo', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue({ id: 'p-1', slug: 's', archivedAt: null })
    membershipFindFirst.mockResolvedValue(null)
    ownershipFindUnique.mockResolvedValue(null)
    userFindUnique.mockResolvedValue({ displayName: 'Max', avatarUrl: null })
    await expect(resolveActorForPlace({ placeId: 'p-1' })).rejects.toBeInstanceOf(
      AuthorizationError,
    )
  })

  it('MEMBER no-owner => isAdmin=false', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue({ id: 'p-1', slug: 's', archivedAt: null })
    membershipFindFirst.mockResolvedValue({ id: 'm-1', role: MembershipRole.MEMBER })
    ownershipFindUnique.mockResolvedValue(null)
    userFindUnique.mockResolvedValue({ displayName: 'Max', avatarUrl: null })
    const actor = await resolveActorForPlace({ placeId: 'p-1' })
    expect(actor.isAdmin).toBe(false)
    expect(actor.userId).toBe('user-1')
    expect(actor.actorId).toBe('user-1')
  })

  it('ADMIN => isAdmin=true', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue({ id: 'p-1', slug: 's', archivedAt: null })
    membershipFindFirst.mockResolvedValue({ id: 'm-1', role: MembershipRole.ADMIN })
    ownershipFindUnique.mockResolvedValue(null)
    userFindUnique.mockResolvedValue({ displayName: 'Admin', avatarUrl: null })
    const actor = await resolveActorForPlace({ placeId: 'p-1' })
    expect(actor.isAdmin).toBe(true)
  })

  it('Owner con rol MEMBER => isAdmin=true (owner hereda)', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue({ id: 'p-1', slug: 's', archivedAt: null })
    membershipFindFirst.mockResolvedValue({ id: 'm-1', role: MembershipRole.MEMBER })
    ownershipFindUnique.mockResolvedValue({ userId: 'user-1' })
    userFindUnique.mockResolvedValue({ displayName: 'Owner', avatarUrl: null })
    const actor = await resolveActorForPlace({ placeId: 'p-1' })
    expect(actor.isAdmin).toBe(true)
  })
})
