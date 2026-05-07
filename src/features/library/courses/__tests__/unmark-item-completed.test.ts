import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Tests para `unmarkItemCompletedAction` (G.3.a).
 *
 * Idempotente — `deleteMany` por (itemId, userId). Si no había row,
 * cuenta = 0 y la action retorna { ok: true } sin error.
 */

const libraryItemFindUnique = vi.fn()
const libraryItemCompletionDeleteMany = vi.fn()
const placeFindUnique = vi.fn()
const ownershipFindUnique = vi.fn()
const membershipFindFirst = vi.fn()
const userFindUnique = vi.fn()
const groupMembershipFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[])
const groupMembershipFindFirst = vi.fn(async (..._a: unknown[]) => null as unknown)
const getUserFn = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    libraryItem: { findUnique: (...a: unknown[]) => libraryItemFindUnique(...a) },
    libraryItemCompletion: {
      deleteMany: (...a: unknown[]) => libraryItemCompletionDeleteMany(...a),
    },
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
    placeOwnership: { findUnique: (...a: unknown[]) => ownershipFindUnique(...a) },
    membership: { findFirst: (...a: unknown[]) => membershipFindFirst(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    groupMembership: {
      findMany: (...a: unknown[]) => groupMembershipFindMany(...a),
      findFirst: (...a: unknown[]) => groupMembershipFindFirst(...a),
    },
  },
}))

vi.mock('@/shared/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: getUserFn } }),
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
}))

vi.mock('server-only', () => ({}))

vi.mock('@/shared/config/env', () => ({
  serverEnv: { NODE_ENV: 'test' },
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    NEXT_PUBLIC_APP_URL: 'http://lvh.me:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000',
  },
}))

import { unmarkItemCompletedAction } from '../server/actions/unmark-item-completed'

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'the-place'
const CATEGORY_SLUG = 'curso-x'
const ITEM_ID = 'item-1'
const ITEM_POST_SLUG = 'item-post-slug'
const ACTOR_ID = 'user-1'

function setupHappyMember(): void {
  getUserFn.mockResolvedValue({ data: { user: { id: ACTOR_ID } } })
  membershipFindFirst.mockResolvedValue({ id: 'mem-1' })
  placeFindUnique.mockResolvedValue({
    id: PLACE_ID,
    slug: PLACE_SLUG,
    name: 'X',
    archivedAt: null,
    themeConfig: null,
    openingHours: null,
  })
  userFindUnique.mockResolvedValue({ displayName: 'Max', avatarUrl: null })
  ownershipFindUnique.mockResolvedValue(null)
  groupMembershipFindMany.mockResolvedValue([])
  groupMembershipFindFirst.mockResolvedValue(null)
  libraryItemFindUnique.mockResolvedValue({
    id: ITEM_ID,
    placeId: PLACE_ID,
    archivedAt: null,
    category: { slug: CATEGORY_SLUG },
    post: { slug: ITEM_POST_SLUG },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('unmarkItemCompletedAction — validación + auth', () => {
  it('rechaza input inválido con ValidationError', async () => {
    await expect(unmarkItemCompletedAction({ itemId: '' })).rejects.toBeInstanceOf(ValidationError)
    expect(getUserFn).not.toHaveBeenCalled()
  })

  it('rechaza sin sesión con AuthorizationError (resolveActorForPlace)', async () => {
    getUserFn.mockResolvedValue({ data: { user: null } })
    libraryItemFindUnique.mockResolvedValue({
      id: ITEM_ID,
      placeId: PLACE_ID,
      archivedAt: null,
      category: { slug: CATEGORY_SLUG },
      post: { slug: ITEM_POST_SLUG },
    })
    await expect(unmarkItemCompletedAction({ itemId: ITEM_ID })).rejects.toBeInstanceOf(
      AuthorizationError,
    )
    expect(libraryItemCompletionDeleteMany).not.toHaveBeenCalled()
  })

  it('rechaza item inexistente con NotFoundError', async () => {
    getUserFn.mockResolvedValue({ data: { user: { id: ACTOR_ID } } })
    libraryItemFindUnique.mockResolvedValue(null)
    await expect(unmarkItemCompletedAction({ itemId: 'item-x' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

describe('unmarkItemCompletedAction — happy path', () => {
  it('miembro desmarca un item completado → { ok: true }', async () => {
    setupHappyMember()
    libraryItemCompletionDeleteMany.mockResolvedValue({ count: 1 })

    const result = await unmarkItemCompletedAction({ itemId: ITEM_ID })

    expect(result).toEqual({ ok: true })
    expect(libraryItemCompletionDeleteMany).toHaveBeenCalledWith({
      where: { itemId: ITEM_ID, userId: ACTOR_ID },
    })
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library/${CATEGORY_SLUG}`)
  })

  it('idempotencia: desmarcar item nunca marcado → { ok: true } (count=0)', async () => {
    setupHappyMember()
    libraryItemCompletionDeleteMany.mockResolvedValue({ count: 0 })

    const result = await unmarkItemCompletedAction({ itemId: ITEM_ID })

    expect(result).toEqual({ ok: true })
    expect(libraryItemCompletionDeleteMany).toHaveBeenCalled()
  })

  it('item archivado: igual permite desmarcar (cleanup post-archive sin error)', async () => {
    setupHappyMember()
    // Cambio: item archivado → permitimos unmark para que el viewer pueda
    // cleanup su completion list aunque el item ya no esté visible.
    libraryItemFindUnique.mockResolvedValue({
      id: ITEM_ID,
      placeId: PLACE_ID,
      archivedAt: new Date(),
      category: { slug: CATEGORY_SLUG },
      post: { slug: ITEM_POST_SLUG },
    })
    libraryItemCompletionDeleteMany.mockResolvedValue({ count: 1 })

    const result = await unmarkItemCompletedAction({ itemId: ITEM_ID })
    expect(result).toEqual({ ok: true })
  })
})
