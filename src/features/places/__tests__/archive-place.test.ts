import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuthorizationError, NotFoundError } from '@/shared/errors/domain-error'

const ownershipFindUnique = vi.fn()
const placeFindUnique = vi.fn()
const placeUpdate = vi.fn()
const membershipFindMany = vi.fn()
const getUserFn = vi.fn()
const revalidatePathFn = vi.fn()
const revalidateTagFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    place: {
      findUnique: (...args: unknown[]) => placeFindUnique(...args),
      update: (...args: unknown[]) => placeUpdate(...args),
    },
    placeOwnership: { findUnique: (...args: unknown[]) => ownershipFindUnique(...args) },
    membership: { findMany: (...args: unknown[]) => membershipFindMany(...args) },
  },
}))

vi.mock('@/shared/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: getUserFn } }),
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
  revalidatePath: (...args: unknown[]) => revalidatePathFn(...args),
  revalidateTag: (...args: unknown[]) => revalidateTagFn(...args),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/shared/config/env', () => ({
  clientEnv: {
    NEXT_PUBLIC_APP_URL: 'http://lvh.me:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000',
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  },
  serverEnv: { SUPABASE_SERVICE_ROLE_KEY: 'service', NODE_ENV: 'test' },
}))

import { archivePlaceAction } from '../server/actions'

const AUTH_OK = { data: { user: { id: 'user-1' } } }
const AUTH_NONE = { data: { user: null } }

beforeEach(() => {
  ownershipFindUnique.mockReset()
  placeFindUnique.mockReset()
  placeUpdate.mockReset()
  membershipFindMany.mockReset()
  membershipFindMany.mockResolvedValue([])
  getUserFn.mockReset()
  revalidatePathFn.mockReset()
  revalidateTagFn.mockReset()
})

describe('archivePlaceAction', () => {
  it('rechaza sin sesión', async () => {
    getUserFn.mockResolvedValue(AUTH_NONE)
    await expect(archivePlaceAction('p1')).rejects.toBeInstanceOf(AuthorizationError)
  })

  it('rechaza si el place no existe', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue(null)
    await expect(archivePlaceAction('p1')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rechaza si el actor NO es owner (ADMIN sin ownership falla)', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue({ id: 'p1', slug: 'p1-slug', archivedAt: null })
    ownershipFindUnique.mockResolvedValue(null)

    await expect(archivePlaceAction('p1')).rejects.toBeInstanceOf(AuthorizationError)
    expect(placeUpdate).not.toHaveBeenCalled()
  })

  it('happy path: owner archiva → update y revalidate', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue({ id: 'p1', slug: 'p1-slug', archivedAt: null })
    ownershipFindUnique.mockResolvedValue({ userId: 'user-1', placeId: 'p1' })
    placeUpdate.mockResolvedValue({ id: 'p1' })

    const res = await archivePlaceAction('p1')

    expect(res).toEqual({ ok: true, alreadyArchived: false })
    expect(placeUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { archivedAt: expect.any(Date) },
    })
    expect(revalidatePathFn).toHaveBeenCalledWith('/inbox')
  })

  it('idempotente: si ya estaba archivado, no vuelve a actualizar', async () => {
    getUserFn.mockResolvedValue(AUTH_OK)
    placeFindUnique.mockResolvedValue({
      id: 'p1',
      slug: 'p1-slug',
      archivedAt: new Date('2026-02-01'),
    })
    ownershipFindUnique.mockResolvedValue({ userId: 'user-1', placeId: 'p1' })

    const res = await archivePlaceAction('p1')

    expect(res).toEqual({ ok: true, alreadyArchived: true })
    expect(placeUpdate).not.toHaveBeenCalled()
  })
})
