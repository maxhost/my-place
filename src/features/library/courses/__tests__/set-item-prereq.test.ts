import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Tests para `setItemPrereqAction` (G.3.a).
 *
 * Permission gate: `library:moderate-categories` con scope a la
 * categoría OR el actor es author del item.
 *
 * Validaciones:
 *  - item existe + categoría existe + categoría kind === 'COURSE'.
 *  - Si prereqItemId !== null: prereq existe + pertenece a la misma
 *    categoría + no forma ciclo.
 */

const libraryItemFindUnique = vi.fn()
const libraryItemFindMany = vi.fn()
const libraryItemUpdate = vi.fn()
const libraryCategoryFindUnique = vi.fn()
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
    libraryItem: {
      findUnique: (...a: unknown[]) => libraryItemFindUnique(...a),
      findMany: (...a: unknown[]) => libraryItemFindMany(...a),
      update: (...a: unknown[]) => libraryItemUpdate(...a),
    },
    libraryCategory: {
      findUnique: (...a: unknown[]) => libraryCategoryFindUnique(...a),
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

import { setItemPrereqAction } from '../server/actions/set-item-prereq'
import { PERMISSIONS_ALL } from '@/features/groups/public'

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'the-place'
const CATEGORY_ID = 'cat-course'
const CATEGORY_SLUG = 'curso-x'
const ITEM_ID = 'item-target'
const PREREQ_ID = 'item-prereq'
const ACTOR_ID = 'user-1'
const AUTHOR_ID = 'user-author'

function setupAuth(actorId: string = ACTOR_ID): void {
  getUserFn.mockResolvedValue({ data: { user: { id: actorId } } })
  membershipFindFirst.mockResolvedValue({ id: 'mem-1' })
  placeFindUnique.mockResolvedValue({
    id: PLACE_ID,
    slug: PLACE_SLUG,
    name: 'The Place',
    archivedAt: null,
    themeConfig: null,
    openingHours: null,
  })
  userFindUnique.mockResolvedValue({ displayName: 'X', avatarUrl: null })
  ownershipFindUnique.mockResolvedValue(null)
  groupMembershipFindMany.mockResolvedValue([])
  groupMembershipFindFirst.mockResolvedValue(null)
}

function mockAdminWithModerate(): void {
  // hasPermission('library:moderate-categories') → true via grupo con todos los permisos.
  groupMembershipFindMany.mockResolvedValue([
    { group: { id: 'grp-mods', permissions: PERMISSIONS_ALL, categoryScopes: [] } },
  ])
  groupMembershipFindFirst.mockResolvedValue({ id: 'gm-mods' })
}

function mockCourseCategory(kind: 'COURSE' | 'GENERAL' = 'COURSE'): void {
  libraryCategoryFindUnique.mockResolvedValue({
    id: CATEGORY_ID,
    placeId: PLACE_ID,
    slug: CATEGORY_SLUG,
    kind,
    archivedAt: null,
  })
}

function mockTargetItem(authorUserId: string | null = AUTHOR_ID): void {
  libraryItemFindUnique.mockImplementation(({ where }: { where: { id: string } }) => {
    if (where.id === ITEM_ID) {
      return Promise.resolve({
        id: ITEM_ID,
        placeId: PLACE_ID,
        categoryId: CATEGORY_ID,
        authorUserId,
        archivedAt: null,
        prereqItemId: null,
        category: { slug: CATEGORY_SLUG },
        post: { slug: 'item-slug' },
      })
    }
    if (where.id === PREREQ_ID) {
      return Promise.resolve({
        id: PREREQ_ID,
        placeId: PLACE_ID,
        categoryId: CATEGORY_ID,
        authorUserId: null,
        archivedAt: null,
        prereqItemId: null,
        category: { slug: CATEGORY_SLUG },
        post: { slug: 'prereq-slug' },
      })
    }
    return Promise.resolve(null)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('setItemPrereqAction — validación + auth', () => {
  it('rechaza input inválido con ValidationError', async () => {
    await expect(setItemPrereqAction({ itemId: '', prereqItemId: null })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(getUserFn).not.toHaveBeenCalled()
  })

  it('rechaza item inexistente con NotFoundError', async () => {
    setupAuth()
    libraryItemFindUnique.mockResolvedValue(null)
    await expect(
      setItemPrereqAction({ itemId: 'item-x', prereqItemId: null }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rechaza categoría inexistente con NotFoundError', async () => {
    setupAuth()
    mockTargetItem()
    libraryCategoryFindUnique.mockResolvedValue(null)
    await expect(
      setItemPrereqAction({ itemId: ITEM_ID, prereqItemId: null }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('rechaza no-moderator y no-author con AuthorizationError', async () => {
    setupAuth() // ACTOR_ID, sin grupos, sin owner.
    mockTargetItem(AUTHOR_ID) // author es OTRO user
    mockCourseCategory()
    await expect(
      setItemPrereqAction({ itemId: ITEM_ID, prereqItemId: null }),
    ).rejects.toBeInstanceOf(AuthorizationError)
    expect(libraryItemUpdate).not.toHaveBeenCalled()
  })
})

describe('setItemPrereqAction — invariantes de payload', () => {
  it('categoría kind=GENERAL → { ok: false, error: category_not_course }', async () => {
    setupAuth()
    mockAdminWithModerate()
    mockTargetItem(ACTOR_ID)
    mockCourseCategory('GENERAL')

    const result = await setItemPrereqAction({
      itemId: ITEM_ID,
      prereqItemId: PREREQ_ID,
    })
    expect(result).toEqual({ ok: false, error: 'category_not_course' })
    expect(libraryItemUpdate).not.toHaveBeenCalled()
  })

  it('prereq inexistente → { ok: false, error: prereq_not_in_category }', async () => {
    setupAuth()
    mockAdminWithModerate()
    mockCourseCategory()
    libraryItemFindUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === ITEM_ID) {
        return Promise.resolve({
          id: ITEM_ID,
          placeId: PLACE_ID,
          categoryId: CATEGORY_ID,
          authorUserId: ACTOR_ID,
          archivedAt: null,
          prereqItemId: null,
          category: { slug: CATEGORY_SLUG },
          post: { slug: 'item-slug' },
        })
      }
      return Promise.resolve(null) // PREREQ_ID no existe
    })

    const result = await setItemPrereqAction({
      itemId: ITEM_ID,
      prereqItemId: PREREQ_ID,
    })
    expect(result).toEqual({ ok: false, error: 'prereq_not_in_category' })
    expect(libraryItemUpdate).not.toHaveBeenCalled()
  })

  it('prereq pertenece a OTRA categoría → { ok: false, error: prereq_not_in_category }', async () => {
    setupAuth()
    mockAdminWithModerate()
    mockCourseCategory()
    libraryItemFindUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === ITEM_ID) {
        return Promise.resolve({
          id: ITEM_ID,
          placeId: PLACE_ID,
          categoryId: CATEGORY_ID,
          authorUserId: ACTOR_ID,
          archivedAt: null,
          prereqItemId: null,
          category: { slug: CATEGORY_SLUG },
          post: { slug: 'item-slug' },
        })
      }
      if (where.id === PREREQ_ID) {
        return Promise.resolve({
          id: PREREQ_ID,
          placeId: PLACE_ID,
          categoryId: 'cat-DIFERENTE',
          authorUserId: null,
          archivedAt: null,
          prereqItemId: null,
          category: { slug: 'otro' },
          post: { slug: 'prereq-slug' },
        })
      }
      return Promise.resolve(null)
    })

    const result = await setItemPrereqAction({
      itemId: ITEM_ID,
      prereqItemId: PREREQ_ID,
    })
    expect(result).toEqual({ ok: false, error: 'prereq_not_in_category' })
    expect(libraryItemUpdate).not.toHaveBeenCalled()
  })

  it('asignación forma ciclo (prereq apunta de vuelta al item) → { ok: false, error: cycle_detected }', async () => {
    setupAuth()
    mockAdminWithModerate()
    mockCourseCategory()
    // ITEM se mockea sin prereq; PREREQ_ID tiene como prereq al ITEM
    // (estado actual). Asignar PREREQ como prereq de ITEM forma ciclo.
    libraryItemFindUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === ITEM_ID) {
        return Promise.resolve({
          id: ITEM_ID,
          placeId: PLACE_ID,
          categoryId: CATEGORY_ID,
          authorUserId: ACTOR_ID,
          archivedAt: null,
          prereqItemId: null,
          category: { slug: CATEGORY_SLUG },
          post: { slug: 'item-slug' },
        })
      }
      if (where.id === PREREQ_ID) {
        return Promise.resolve({
          id: PREREQ_ID,
          placeId: PLACE_ID,
          categoryId: CATEGORY_ID,
          authorUserId: null,
          archivedAt: null,
          prereqItemId: ITEM_ID, // ← ya apunta de vuelta
          category: { slug: CATEGORY_SLUG },
          post: { slug: 'prereq-slug' },
        })
      }
      return Promise.resolve(null)
    })
    libraryItemFindMany.mockResolvedValue([
      { id: ITEM_ID, prereqItemId: null },
      { id: PREREQ_ID, prereqItemId: ITEM_ID },
    ])

    const result = await setItemPrereqAction({
      itemId: ITEM_ID,
      prereqItemId: PREREQ_ID,
    })
    expect(result).toEqual({ ok: false, error: 'cycle_detected' })
    expect(libraryItemUpdate).not.toHaveBeenCalled()
  })

  it('autoreferencia (itemId === prereqItemId) → { ok: false, error: cycle_detected }', async () => {
    setupAuth()
    mockAdminWithModerate()
    mockCourseCategory()
    libraryItemFindUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      // En autoreferencia, ambos lookups apuntan al mismo registro.
      if (where.id === ITEM_ID) {
        return Promise.resolve({
          id: ITEM_ID,
          placeId: PLACE_ID,
          categoryId: CATEGORY_ID,
          authorUserId: ACTOR_ID,
          archivedAt: null,
          prereqItemId: null,
          category: { slug: CATEGORY_SLUG },
          post: { slug: 'item-slug' },
        })
      }
      return Promise.resolve(null)
    })
    libraryItemFindMany.mockResolvedValue([{ id: ITEM_ID, prereqItemId: null }])

    const result = await setItemPrereqAction({
      itemId: ITEM_ID,
      prereqItemId: ITEM_ID,
    })
    expect(result).toEqual({ ok: false, error: 'cycle_detected' })
    expect(libraryItemUpdate).not.toHaveBeenCalled()
  })
})

describe('setItemPrereqAction — happy paths', () => {
  it('admin con perm moderate-categories: setea prereq → { ok: true }', async () => {
    setupAuth()
    mockAdminWithModerate()
    mockCourseCategory()
    mockTargetItem(AUTHOR_ID) // actor NO es author, pero tiene perm
    libraryItemFindMany.mockResolvedValue([
      { id: ITEM_ID, prereqItemId: null },
      { id: PREREQ_ID, prereqItemId: null },
    ])

    const result = await setItemPrereqAction({
      itemId: ITEM_ID,
      prereqItemId: PREREQ_ID,
    })
    expect(result).toEqual({ ok: true })
    expect(libraryItemUpdate).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: { prereqItemId: PREREQ_ID },
    })
  })

  it('author del item (sin moderate-categories): puede setear prereq', async () => {
    setupAuth() // ACTOR_ID sin perm
    mockTargetItem(ACTOR_ID) // ACTOR es el author
    mockCourseCategory()
    libraryItemFindMany.mockResolvedValue([
      { id: ITEM_ID, prereqItemId: null },
      { id: PREREQ_ID, prereqItemId: null },
    ])

    const result = await setItemPrereqAction({
      itemId: ITEM_ID,
      prereqItemId: PREREQ_ID,
    })
    expect(result).toEqual({ ok: true })
    expect(libraryItemUpdate).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: { prereqItemId: PREREQ_ID },
    })
  })

  it('limpiar prereq (prereqItemId: null): no requiere fetch del prereq ni cycle check', async () => {
    setupAuth()
    mockAdminWithModerate()
    mockTargetItem(AUTHOR_ID)
    mockCourseCategory()

    const result = await setItemPrereqAction({
      itemId: ITEM_ID,
      prereqItemId: null,
    })
    expect(result).toEqual({ ok: true })
    expect(libraryItemUpdate).toHaveBeenCalledWith({
      where: { id: ITEM_ID },
      data: { prereqItemId: null },
    })
    // findMany para cycle check NO se llama si prereqItemId es null.
    expect(libraryItemFindMany).not.toHaveBeenCalled()
  })

  it('revalida paths del item después de setear', async () => {
    setupAuth()
    mockAdminWithModerate()
    mockTargetItem(AUTHOR_ID)
    mockCourseCategory()
    libraryItemFindMany.mockResolvedValue([
      { id: ITEM_ID, prereqItemId: null },
      { id: PREREQ_ID, prereqItemId: null },
    ])

    await setItemPrereqAction({ itemId: ITEM_ID, prereqItemId: PREREQ_ID })

    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library/${CATEGORY_SLUG}`)
  })
})
