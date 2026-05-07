import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Tests para `markItemCompletedAction` (G.3.a).
 *
 * Cualquier miembro activo puede marcar (caller validó membership +
 * read access en la page). Idempotente — si ya estaba completado,
 * retorna `alreadyCompleted: true` sin error.
 */

const libraryItemFindUnique = vi.fn()
const libraryItemCompletionCreate = vi.fn()
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
      create: (...a: unknown[]) => libraryItemCompletionCreate(...a),
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

import { markItemCompletedAction } from '../server/actions/mark-item-completed'

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
  libraryItemCompletionCreate.mockResolvedValue({
    itemId: ITEM_ID,
    userId: ACTOR_ID,
    completedAt: new Date(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('markItemCompletedAction — validación + auth', () => {
  it('rechaza input inválido con ValidationError', async () => {
    await expect(markItemCompletedAction({ itemId: '' })).rejects.toBeInstanceOf(ValidationError)
    expect(getUserFn).not.toHaveBeenCalled()
  })

  it('rechaza sin sesión con AuthorizationError (resolveActorForPlace)', async () => {
    getUserFn.mockResolvedValue({ data: { user: null } })
    // El item se busca antes del auth gate (orden consistente con
    // archive-item/update-item del slice padre). Auth falla en
    // resolveActorForPlace → AuthorizationError.
    libraryItemFindUnique.mockResolvedValue({
      id: ITEM_ID,
      placeId: PLACE_ID,
      archivedAt: null,
      category: { slug: CATEGORY_SLUG },
      post: { slug: ITEM_POST_SLUG },
    })
    await expect(markItemCompletedAction({ itemId: ITEM_ID })).rejects.toBeInstanceOf(
      AuthorizationError,
    )
    expect(libraryItemCompletionCreate).not.toHaveBeenCalled()
  })

  it('rechaza item inexistente con NotFoundError', async () => {
    getUserFn.mockResolvedValue({ data: { user: { id: ACTOR_ID } } })
    libraryItemFindUnique.mockResolvedValue(null)
    await expect(markItemCompletedAction({ itemId: 'item-x' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })
})

describe('markItemCompletedAction — happy path', () => {
  it('miembro marca item por primera vez → { ok: true, alreadyCompleted: false }', async () => {
    setupHappyMember()

    const result = await markItemCompletedAction({ itemId: ITEM_ID })

    expect(result).toEqual({ ok: true, alreadyCompleted: false })
    expect(libraryItemCompletionCreate).toHaveBeenCalledWith({
      data: { itemId: ITEM_ID, userId: ACTOR_ID },
    })
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library/${CATEGORY_SLUG}`)
  })

  it('idempotencia: segunda invocación con misma combinación → { ok: true, alreadyCompleted: true }', async () => {
    setupHappyMember()
    libraryItemCompletionCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    )

    const result = await markItemCompletedAction({ itemId: ITEM_ID })

    expect(result).toEqual({ ok: true, alreadyCompleted: true })
    // Sí revalida igual (caso edge: alguien recargó la page, su completion
    // estaba en cache, queremos forzar refresh).
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library/${CATEGORY_SLUG}`)
  })

  it('rechaza item archivado con NotFoundError', async () => {
    setupHappyMember()
    libraryItemFindUnique.mockResolvedValue({
      id: ITEM_ID,
      placeId: PLACE_ID,
      archivedAt: new Date(),
      category: { slug: CATEGORY_SLUG },
      post: { slug: ITEM_POST_SLUG },
    })

    await expect(markItemCompletedAction({ itemId: ITEM_ID })).rejects.toBeInstanceOf(NotFoundError)
    expect(libraryItemCompletionCreate).not.toHaveBeenCalled()
  })
})
