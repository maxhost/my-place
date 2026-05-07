import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Tests de `updateLibraryCategoryAction` (R.7.2 — M3 batch).
 *
 * Mismo patrón que `archive-category.test.ts` (plantilla M3 pilot):
 *  1. Mocks granulares de Prisma por modelo (libraryCategory + identidad).
 *  2. Mock de Supabase auth y de `next/cache`.
 *  3. Helper local `mockActiveMember(role, opts)` inline.
 *  4. `vi.clearAllMocks()` en `beforeEach`.
 *  5. Imports de la action al final, después de los `vi.mock` (hoisting).
 *
 * `resolveActorForPlace` corre real, consumiendo las primitives mockeadas.
 */

// ---------------------------------------------------------------
// Prisma + auxiliares mockeados
// ---------------------------------------------------------------

const libraryCategoryFindUnique = vi.fn()
const libraryCategoryUpdate = vi.fn()
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

vi.mock('@/db/client', () => ({
  prisma: {
    libraryCategory: {
      findUnique: (...a: unknown[]) => libraryCategoryFindUnique(...a),
      update: (...a: unknown[]) => libraryCategoryUpdate(...a),
    },
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
    membership: { findFirst: (...a: unknown[]) => membershipFindFirst(...a) },
    placeOwnership: { findUnique: (...a: unknown[]) => ownershipFindUnique(...a) },
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
  revalidateTag: vi.fn(),
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

import { updateLibraryCategoryAction } from '@/features/library/admin/server/actions/update-category'
import { PERMISSIONS_ALL } from '@/features/groups/public'

// ---------------------------------------------------------------
// Fixtures + helper
// ---------------------------------------------------------------

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'the-place'
const USER_ID = 'user-1'
const CATEGORY_ID = 'cat-1'
const CATEGORY_SLUG = 'recetas'

type ActorOpts = {
  /** Si true, mockea grupos para que `isAdmin`/`hasPermission` retornen true. */
  asAdmin?: boolean
  /** Si true, ownership row presente — gatilla `isAdmin` aunque no sea admin. */
  isOwner?: boolean
}

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

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    categoryId: CATEGORY_ID,
    title: 'Recetas',
    emoji: '🍳',
    contributionPolicy: 'MEMBERS_OPEN',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe('updateLibraryCategoryAction — happy paths', () => {
  it('admin: actualiza title/emoji/contributionPolicy y revalida los 3 paths', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
    })
    libraryCategoryUpdate.mockResolvedValue({ id: CATEGORY_ID })

    const result = await updateLibraryCategoryAction(
      validInput({
        title: '  Recetas de la abuela  ',
        emoji: '🥘',
        contributionPolicy: 'DESIGNATED',
      }),
    )

    expect(result).toEqual({
      ok: true,
      categoryId: CATEGORY_ID,
      slug: CATEGORY_SLUG,
    })
    expect(libraryCategoryUpdate).toHaveBeenCalledTimes(1)
    expect(libraryCategoryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CATEGORY_ID },
        data: expect.objectContaining({
          // El title se persiste trimmeado.
          title: 'Recetas de la abuela',
          emoji: '🥘',
          contributionPolicy: 'DESIGNATED',
        }),
      }),
    )
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library/${CATEGORY_SLUG}`)
  })

  it('update parcial: cambiar solo emoji manteniendo el title funciona', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
    })
    libraryCategoryUpdate.mockResolvedValue({ id: CATEGORY_ID })

    const result = await updateLibraryCategoryAction(
      validInput({ emoji: '🍲', title: 'Recetas', contributionPolicy: 'MEMBERS_OPEN' }),
    )

    expect(result.ok).toBe(true)
    expect(libraryCategoryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CATEGORY_ID },
        data: expect.objectContaining({
          title: 'Recetas',
          emoji: '🍲',
          contributionPolicy: 'MEMBERS_OPEN',
        }),
      }),
    )
  })
})

describe('updateLibraryCategoryAction — autorización', () => {
  it('member común (no admin, no owner): AuthorizationError sin tocar update', async () => {
    mockActiveMember()
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
    })

    await expect(updateLibraryCategoryAction(validInput())).rejects.toBeInstanceOf(
      AuthorizationError,
    )

    expect(libraryCategoryUpdate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })
})

describe('updateLibraryCategoryAction — errores estructurales', () => {
  it('categoría inexistente: NotFoundError antes de resolver actor', async () => {
    libraryCategoryFindUnique.mockResolvedValue(null)

    await expect(
      updateLibraryCategoryAction(validInput({ categoryId: 'cat-missing' })),
    ).rejects.toBeInstanceOf(NotFoundError)

    // Short-circuit: no se intenta resolver actor ni queries posteriores.
    expect(getUserFn).not.toHaveBeenCalled()
    expect(placeFindUnique).not.toHaveBeenCalled()
    expect(libraryCategoryUpdate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })

  it('input con title vacío: ValidationError sin tocar Prisma', async () => {
    await expect(updateLibraryCategoryAction(validInput({ title: '' }))).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(libraryCategoryFindUnique).not.toHaveBeenCalled()
  })

  it('input con title demasiado largo (>60 chars): ValidationError sin tocar Prisma', async () => {
    await expect(
      updateLibraryCategoryAction(validInput({ title: 'x'.repeat(61) })),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(libraryCategoryFindUnique).not.toHaveBeenCalled()
  })

  it('input con emoji vacío: ValidationError sin tocar Prisma', async () => {
    await expect(updateLibraryCategoryAction(validInput({ emoji: '' }))).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(libraryCategoryFindUnique).not.toHaveBeenCalled()
  })

  it('input con contributionPolicy inválido: ValidationError sin tocar Prisma', async () => {
    await expect(
      updateLibraryCategoryAction(validInput({ contributionPolicy: 'NOT_A_POLICY' })),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(libraryCategoryFindUnique).not.toHaveBeenCalled()
  })
})
