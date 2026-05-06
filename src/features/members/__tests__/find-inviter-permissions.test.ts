import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests para `findInviterPermissions` (alias `findMemberPermissions`).
 *
 * Plan #2.3 (perf): el helper ahora se cachea cross-request via
 * `unstable_cache` con tag `perms:${userId}:${placeId}`. Estos tests
 * cubren:
 *  1. Resultado correcto (composición de los 3 primitives) — sin
 *     entrar a detalles de cache.
 *  2. El wrapper invoca `unstable_cache` con la clave `['perms', userId,
 *     placeId]` y el tag `perms:${userId}:${placeId}` (verificable via
 *     mock).
 *
 * El comportamiento real de "no re-ejecutar entre requests" es
 * responsabilidad de Next y no se simula acá — el test verifica el
 * contrato de uso.
 */

// `vi.hoisted` para que los mocks queden disponibles en `vi.mock` (que se
// hoistea al top del archivo). Sin esto, ReferenceError por TDZ.
const hoisted = vi.hoisted(() => {
  const findActiveMembershipMock = vi.fn()
  const findPlaceOwnershipMock = vi.fn()
  const findIsPlaceAdminMock = vi.fn()
  // Capturamos los argumentos de `unstable_cache` para validar la
  // key/tag/revalidate que el wrapper les pasa. La impl del mock simula el
  // wrapping: retorna una función que, al invocarse, ejecuta el factory
  // original — sin caching real.
  const unstableCacheCalls: Array<{
    keyParts: readonly unknown[]
    options: { tags?: readonly string[]; revalidate?: number | false } | undefined
  }> = []
  const unstableCacheMock = vi.fn(
    (
      fn: (...args: never[]) => Promise<unknown>,
      keyParts: readonly unknown[],
      options?: { tags?: readonly string[]; revalidate?: number | false },
    ) => {
      unstableCacheCalls.push({ keyParts, options })
      return fn
    },
  )
  return {
    findActiveMembershipMock,
    findPlaceOwnershipMock,
    findIsPlaceAdminMock,
    unstableCacheMock,
    unstableCacheCalls,
  }
})

const {
  findActiveMembershipMock,
  findPlaceOwnershipMock,
  findIsPlaceAdminMock,
  unstableCacheMock,
  unstableCacheCalls,
} = hoisted

vi.mock('@/shared/lib/identity-cache', () => ({
  findActiveMembership: (...a: unknown[]) => hoisted.findActiveMembershipMock(...a),
  findPlaceOwnership: (...a: unknown[]) => hoisted.findPlaceOwnershipMock(...a),
  findIsPlaceAdmin: (...a: unknown[]) => hoisted.findIsPlaceAdminMock(...a),
}))

vi.mock('@/db/client', () => ({
  prisma: {},
}))

vi.mock('next/cache', () => ({
  unstable_cache: hoisted.unstableCacheMock,
}))

vi.mock('server-only', () => ({}))

import { findInviterPermissions } from '../server/queries'

beforeEach(() => {
  findActiveMembershipMock.mockReset()
  findPlaceOwnershipMock.mockReset()
  findIsPlaceAdminMock.mockReset()
  unstableCacheCalls.length = 0
  unstableCacheMock.mockClear()
})

describe('findInviterPermissions', () => {
  it('compone los 3 primitives: isMember, isOwner, isAdmin (owner ⇒ admin implícito)', async () => {
    findActiveMembershipMock.mockResolvedValue({ id: 'mem-1' })
    findPlaceOwnershipMock.mockResolvedValue(true)
    findIsPlaceAdminMock.mockResolvedValue(false)

    const perms = await findInviterPermissions('user-1', 'place-1')
    expect(perms).toEqual({ isMember: true, isOwner: true, isAdmin: true })
  })

  it('isAdmin=true cuando es admin del preset aunque no sea owner', async () => {
    findActiveMembershipMock.mockResolvedValue({ id: 'mem-1' })
    findPlaceOwnershipMock.mockResolvedValue(false)
    findIsPlaceAdminMock.mockResolvedValue(true)

    const perms = await findInviterPermissions('user-1', 'place-1')
    expect(perms).toEqual({ isMember: true, isOwner: false, isAdmin: true })
  })

  it('isMember=false cuando no hay membership activa', async () => {
    findActiveMembershipMock.mockResolvedValue(null)
    findPlaceOwnershipMock.mockResolvedValue(false)
    findIsPlaceAdminMock.mockResolvedValue(false)

    const perms = await findInviterPermissions('user-stranger', 'place-1')
    expect(perms).toEqual({ isMember: false, isOwner: false, isAdmin: false })
  })

  it('wrappea con unstable_cache usando key=[perms, userId, placeId] y tag=perms:userId:placeId', async () => {
    findActiveMembershipMock.mockResolvedValue({ id: 'mem-1' })
    findPlaceOwnershipMock.mockResolvedValue(false)
    findIsPlaceAdminMock.mockResolvedValue(false)

    await findInviterPermissions('user-abc', 'place-xyz')

    // El wrapper registra exactamente UN call a unstable_cache por invocación
    // del helper (luego React.cache deduplica por args dentro del mismo render).
    expect(unstableCacheCalls.length).toBeGreaterThanOrEqual(1)
    const call = unstableCacheCalls.at(-1)!
    expect(call.keyParts).toEqual(['perms', 'user-abc', 'place-xyz'])
    expect(call.options?.tags).toEqual(['perms:user-abc:place-xyz'])
    expect(call.options?.revalidate).toBe(60)
  })
})
