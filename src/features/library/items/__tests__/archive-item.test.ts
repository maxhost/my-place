import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Test para `archiveLibraryItemAction` (R.7.2 — pilot M3).
 *
 * Replica el patrón de `archive-category.test.ts`:
 *  1. Mocks granulares de Prisma por modelo (libraryItem + identidad).
 *  2. Mock de Supabase auth (`createSupabaseServer`) y de `next/cache`.
 *  3. Helper local `mockActiveMember(role, opts)` inline — no compartido.
 *  4. `vi.clearAllMocks()` en `beforeEach`.
 *  5. Imports de la action al final, después de los `vi.mock` (hoisting).
 *
 * `resolveActorForPlace` no se mockea: corre real y consume las primitives
 * de Prisma + Supabase ya mockeadas. Esto cubre el wiring
 * `auth → place → membership → ownership → user` sin acoplar al detalle.
 */

// ---------------------------------------------------------------
// Prisma + auxiliares mockeados
// ---------------------------------------------------------------

const libraryItemFindUnique = vi.fn()
const libraryItemUpdate = vi.fn()
const placeFindUnique = vi.fn()
const membershipFindFirst = vi.fn()
const ownershipFindUnique = vi.fn()
const userFindUnique = vi.fn()
const getUserFn = vi.fn()
const revalidatePathFn = vi.fn()
// G.3: hasPermission cae a `prisma.groupMembership.findMany` cuando el
// fallback role===ADMIN no aplica. Default [] (sin grupos).
const groupMembershipFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[])
// C.2: `findIsPlaceAdmin` (identity-cache) usa `findFirst` para chequear
// membership al preset group. Default null (no admin).
const groupMembershipFindFirst = vi.fn(async (..._a: unknown[]) => null as unknown)
// G.4 (2026-05-04): `resolveLibraryViewer` consulta tierMembership.findMany
// para popular `viewer.tierIds`. Default [] (sin tiers).
const tierMembershipFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[])

vi.mock('@/db/client', () => ({
  prisma: {
    libraryItem: {
      findUnique: (...a: unknown[]) => libraryItemFindUnique(...a),
      update: (...a: unknown[]) => libraryItemUpdate(...a),
    },
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
    membership: { findFirst: (...a: unknown[]) => membershipFindFirst(...a) },
    placeOwnership: { findUnique: (...a: unknown[]) => ownershipFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    groupMembership: {
      findMany: (...a: unknown[]) => groupMembershipFindMany(...a),
      findFirst: (...a: unknown[]) => groupMembershipFindFirst(...a),
    },
    tierMembership: {
      findMany: (...a: unknown[]) => tierMembershipFindMany(...a),
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

// ---------------------------------------------------------------
// Imports después del setup (hoisting de vi.mock)
// ---------------------------------------------------------------

import { archiveLibraryItemAction } from '@/features/library/items/server/actions/archive-item'
import { PERMISSIONS_ALL } from '@/features/groups/public'

// ---------------------------------------------------------------
// Fixtures + helper
// ---------------------------------------------------------------

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'the-place'
const USER_ID = 'user-1'
const OTHER_USER_ID = 'user-2'
const ITEM_ID = 'item-1'
const CATEGORY_SLUG = 'recetas'
const POST_SLUG = 'pan-de-campo'

type ActorOpts = {
  /** Si true, mockea grupos para que `isAdmin`/`hasPermission` retornen true. */
  asAdmin?: boolean
  /** Si true, ownership row presente — gatilla `isAdmin` aunque no sea admin. */
  isOwner?: boolean
}

/**
 * Setea la cadena completa que `resolveActorForPlace` consume:
 *   getUser → place.findUnique → membership.findFirst →
 *   placeOwnership.findUnique → user.findUnique.
 *
 * Por defecto: usuario autenticado, place activo, membership sin
 * privilegios, sin ownership. `opts.isOwner=true` agrega la fila de
 * ownership. `opts.asAdmin=true` mockea los grupos del preset.
 */
function mockActiveMember(opts: ActorOpts = {}): void {
  getUserFn.mockResolvedValue({ data: { user: { id: USER_ID } } })
  placeFindUnique.mockResolvedValue({
    id: PLACE_ID,
    slug: PLACE_SLUG,
    name: 'The Place',
    archivedAt: null,
    themeConfig: null,
    openingHours: null,
  })
  membershipFindFirst.mockResolvedValue({ id: 'm-1' })
  ownershipFindUnique.mockResolvedValue(opts.isOwner ? { userId: USER_ID } : null)
  userFindUnique.mockResolvedValue({ displayName: 'Max', avatarUrl: null })
  // C.2: si opts.asAdmin, simular membership al preset group con TODOS los
  // permisos para que `hasPermission` retorne true y `findIsPlaceAdmin`
  // retorne true sin depender del fallback `role === 'ADMIN'` (drop en C.3).
  if (opts.asAdmin) {
    groupMembershipFindMany.mockResolvedValue([
      { group: { id: 'grp-mock-admin', permissions: PERMISSIONS_ALL, categoryScopes: [] } },
    ])
    groupMembershipFindFirst.mockResolvedValue({ id: 'gm-mock-admin' })
  } else {
    groupMembershipFindMany.mockResolvedValue([])
    groupMembershipFindFirst.mockResolvedValue(null)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe('archiveLibraryItemAction — happy paths', () => {
  it('admin: archiva item no archivado y revalida los paths del item', async () => {
    mockActiveMember({ asAdmin: true })
    libraryItemFindUnique.mockResolvedValue({
      id: ITEM_ID,
      placeId: PLACE_ID,
      authorUserId: OTHER_USER_ID,
      archivedAt: null,
      category: { slug: CATEGORY_SLUG },
      post: { slug: POST_SLUG },
    })
    libraryItemUpdate.mockResolvedValue({ id: ITEM_ID })

    const result = await archiveLibraryItemAction({ itemId: ITEM_ID })

    expect(result).toEqual({
      ok: true,
      itemId: ITEM_ID,
      alreadyArchived: false,
    })
    expect(libraryItemUpdate).toHaveBeenCalledTimes(1)
    expect(libraryItemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ITEM_ID },
        data: expect.objectContaining({ archivedAt: expect.any(Date) }),
      }),
    )
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library/${CATEGORY_SLUG}`)
    expect(revalidatePathFn).toHaveBeenCalledWith(
      `/${PLACE_SLUG}/library/${CATEGORY_SLUG}/${POST_SLUG}`,
    )
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/conversations`)
  })

  it('author del item (member sin ADMIN): canArchiveItem permite archivar', async () => {
    mockActiveMember()
    libraryItemFindUnique.mockResolvedValue({
      id: ITEM_ID,
      placeId: PLACE_ID,
      authorUserId: USER_ID,
      archivedAt: null,
      category: { slug: CATEGORY_SLUG },
      post: { slug: POST_SLUG },
    })
    libraryItemUpdate.mockResolvedValue({ id: ITEM_ID })

    const result = await archiveLibraryItemAction({ itemId: ITEM_ID })

    expect(result.ok).toBe(true)
    expect(result.alreadyArchived).toBe(false)
    expect(libraryItemUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('archiveLibraryItemAction — idempotencia', () => {
  it('item ya archivado: no llama update ni revalidate y devuelve alreadyArchived=true', async () => {
    mockActiveMember({ asAdmin: true })
    libraryItemFindUnique.mockResolvedValue({
      id: ITEM_ID,
      placeId: PLACE_ID,
      authorUserId: OTHER_USER_ID,
      archivedAt: new Date('2026-04-01T12:00:00Z'),
      category: { slug: CATEGORY_SLUG },
      post: { slug: POST_SLUG },
    })

    const result = await archiveLibraryItemAction({ itemId: ITEM_ID })

    expect(result).toEqual({
      ok: true,
      itemId: ITEM_ID,
      alreadyArchived: true,
    })
    expect(libraryItemUpdate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })
})

describe('archiveLibraryItemAction — autorización', () => {
  it('member común no-author (no admin, no owner): AuthorizationError sin tocar update', async () => {
    mockActiveMember()
    libraryItemFindUnique.mockResolvedValue({
      id: ITEM_ID,
      placeId: PLACE_ID,
      authorUserId: OTHER_USER_ID,
      archivedAt: null,
      category: { slug: CATEGORY_SLUG },
      post: { slug: POST_SLUG },
    })

    await expect(archiveLibraryItemAction({ itemId: ITEM_ID })).rejects.toBeInstanceOf(
      AuthorizationError,
    )

    expect(libraryItemUpdate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })
})

describe('archiveLibraryItemAction — errores estructurales', () => {
  it('item inexistente: NotFoundError antes de resolver actor', async () => {
    libraryItemFindUnique.mockResolvedValue(null)

    await expect(archiveLibraryItemAction({ itemId: 'item-missing' })).rejects.toBeInstanceOf(
      NotFoundError,
    )

    // Short-circuit: no se intenta resolver actor ni queries posteriores.
    expect(getUserFn).not.toHaveBeenCalled()
    expect(placeFindUnique).not.toHaveBeenCalled()
    expect(libraryItemUpdate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })

  it('input con itemId vacío: ValidationError sin tocar Prisma', async () => {
    await expect(archiveLibraryItemAction({ itemId: '' })).rejects.toBeInstanceOf(ValidationError)
    expect(libraryItemFindUnique).not.toHaveBeenCalled()
  })

  it('input sin itemId: ValidationError sin tocar Prisma', async () => {
    await expect(archiveLibraryItemAction({})).rejects.toBeInstanceOf(ValidationError)
    expect(libraryItemFindUnique).not.toHaveBeenCalled()
  })
})
