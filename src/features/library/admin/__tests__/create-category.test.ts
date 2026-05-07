import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, ValidationError } from '@/shared/errors/domain-error'
import { CategoryLimitReachedError } from '@/features/library/domain/errors'
import { MAX_CATEGORIES_PER_PLACE } from '@/features/library/domain/invariants'

/**
 * Test de `createLibraryCategoryAction` (M3 batch).
 *
 * Replica el patrón pilot de `archive-category.test.ts`:
 *  1. Mocks granulares de Prisma (libraryCategory.{count, findMany, create}
 *     + identidad place/membership/ownership/user).
 *  2. Mock de Supabase auth + `next/cache` + `server-only` + env.
 *  3. Mock del logger porque la action loguea on success (a diferencia de
 *     archive, que es silenciosa).
 *  4. Helper local `mockActiveMember(role, opts)`.
 *  5. `vi.clearAllMocks()` en `beforeEach`.
 *  6. Imports de la action al final, post `vi.mock` (hoisting).
 *
 * `resolveActorForPlace` corre real, alimentado por las primitives
 * Prisma+Supabase mockeadas. Cobertura realista del wiring sin acoplar
 * al detalle interno.
 */

// ---------------------------------------------------------------
// Prisma + auxiliares mockeados
// ---------------------------------------------------------------

const libraryCategoryCount = vi.fn()
const libraryCategoryFindMany = vi.fn()
const libraryCategoryCreate = vi.fn()
const placeFindUnique = vi.fn()
const membershipFindFirst = vi.fn()
const ownershipFindUnique = vi.fn()
const userFindUnique = vi.fn()
const getUserFn = vi.fn()
const revalidatePathFn = vi.fn()
const transactionFn = vi.fn()
const txExecuteRaw = vi.fn()
// G.3: hasPermission cae a `prisma.groupMembership.findMany` cuando el
// fallback role===ADMIN no aplica. Default [] (sin grupos).
const groupMembershipFindMany = vi.fn(async (..._a: unknown[]) => [] as unknown[])
// C.2: `findIsPlaceAdmin` (identity-cache) usa `findFirst` para chequear
// membership al preset group. Default null (no admin).
const groupMembershipFindFirst = vi.fn(async (..._a: unknown[]) => null as unknown)

vi.mock('@/db/client', () => ({
  prisma: {
    libraryCategory: {
      count: (...a: unknown[]) => libraryCategoryCount(...a),
      findMany: (...a: unknown[]) => libraryCategoryFindMany(...a),
      create: (...a: unknown[]) => libraryCategoryCreate(...a),
    },
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
    membership: { findFirst: (...a: unknown[]) => membershipFindFirst(...a) },
    placeOwnership: { findUnique: (...a: unknown[]) => ownershipFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    groupMembership: {
      findMany: (...a: unknown[]) => groupMembershipFindMany(...a),
      findFirst: (...a: unknown[]) => groupMembershipFindFirst(...a),
    },
    $transaction: (fn: (tx: unknown) => unknown) => transactionFn(fn),
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

vi.mock('@/shared/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

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

import { createLibraryCategoryAction } from '@/features/library/admin/server/actions/create-category'
import { PERMISSIONS_ALL } from '@/features/groups/public'

// ---------------------------------------------------------------
// Fixtures + helper
// ---------------------------------------------------------------

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'the-place'
const USER_ID = 'user-1'
const NEW_CATEGORY_ID = 'cat-new'

type ActorOpts = {
  /** Si true, mockea grupos para que `isAdmin`/`hasPermission` retornen true. */
  asAdmin?: boolean
  /** Si true, ownership row presente — gatilla `isAdmin` aunque no sea admin. */
  isOwner?: boolean
}

/**
 * Setea la cadena que `resolveActorForPlace` consume:
 *   getUser → place.findUnique → membership.findFirst →
 *   placeOwnership.findUnique → user.findUnique.
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
  // El `$transaction` callback recibe un `tx` que comparte las mismas
  // primitives que el cliente raíz (count/findMany/create) más
  // `$executeRaw` para `acquireCategorySetLock`. Esto refleja que la
  // action ahora encapsula todo el work bajo el lock advisory.
  transactionFn.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({
      libraryCategory: {
        count: (...a: unknown[]) => libraryCategoryCount(...a),
        findMany: (...a: unknown[]) => libraryCategoryFindMany(...a),
        create: (...a: unknown[]) => libraryCategoryCreate(...a),
      },
      $executeRaw: (...a: unknown[]) => txExecuteRaw(...a),
    }),
  )
  // Default: el lock se adquiere sin error.
  txExecuteRaw.mockResolvedValue(1)
})

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe('createLibraryCategoryAction — happy paths', () => {
  it('admin: crea categoría con slug derivado del título y revalida 3 paths', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryCount.mockResolvedValue(5)
    libraryCategoryFindMany.mockResolvedValue([])
    libraryCategoryCreate.mockResolvedValue({ id: NEW_CATEGORY_ID, slug: 'recetas' })

    const result = await createLibraryCategoryAction({
      placeId: PLACE_ID,
      title: 'Recetas',
      emoji: '🥗',
      contributionPolicy: 'MEMBERS_OPEN',
    })

    expect(result).toEqual({ ok: true, categoryId: NEW_CATEGORY_ID, slug: 'recetas' })
    // El lock advisory se adquiere antes de los writes — soft assertion
    // sobre el SQL para verificar que la action consume el helper.
    expect(transactionFn).toHaveBeenCalledTimes(1)
    expect(txExecuteRaw).toHaveBeenCalled()
    const lockCallSql = JSON.stringify(txExecuteRaw.mock.calls[0])
    expect(lockCallSql).toContain('pg_advisory_xact_lock')
    expect(libraryCategoryCreate).toHaveBeenCalledTimes(1)
    expect(libraryCategoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          placeId: PLACE_ID,
          slug: 'recetas',
          emoji: '🥗',
          title: 'Recetas',
          contributionPolicy: 'MEMBERS_OPEN',
        }),
      }),
    )
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library/recetas`)
  })

  it('owner sin rol ADMIN: ownership row alcanza para crear', async () => {
    mockActiveMember({ isOwner: true })
    libraryCategoryCount.mockResolvedValue(0)
    libraryCategoryFindMany.mockResolvedValue([])
    libraryCategoryCreate.mockResolvedValue({ id: NEW_CATEGORY_ID, slug: 'libros' })

    const result = await createLibraryCategoryAction({
      placeId: PLACE_ID,
      title: 'Libros',
      emoji: '📚',
    })

    expect(result.ok).toBe(true)
    expect(result.slug).toBe('libros')
    expect(ownershipFindUnique).toHaveBeenCalled()
    expect(libraryCategoryCreate).toHaveBeenCalledTimes(1)
    // Default contributionPolicy = MEMBERS_OPEN (post-2026-05-04 ADR).
    expect(libraryCategoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contributionPolicy: 'MEMBERS_OPEN' }),
      }),
    )
  })

  it('título con título colisiona con slug reservado: aplica sufijo numérico', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryCount.mockResolvedValue(2)
    // No slugs existentes en DB; el título "New" choca con RESERVED.
    libraryCategoryFindMany.mockResolvedValue([])
    libraryCategoryCreate.mockResolvedValue({ id: NEW_CATEGORY_ID, slug: 'new-2' })

    const result = await createLibraryCategoryAction({
      placeId: PLACE_ID,
      title: 'New',
      emoji: '✨',
    })

    expect(result.slug).toBe('new-2')
    expect(libraryCategoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slug: 'new-2' }),
      }),
    )
  })

  it('título colisiona con slug existente del place: aplica sufijo numérico', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryCount.mockResolvedValue(1)
    // El slug 'recetas' ya existe (categoría archivada o activa de antes).
    libraryCategoryFindMany.mockResolvedValue([{ slug: 'recetas' }])
    libraryCategoryCreate.mockResolvedValue({ id: NEW_CATEGORY_ID, slug: 'recetas-2' })

    const result = await createLibraryCategoryAction({
      placeId: PLACE_ID,
      title: 'Recetas',
      emoji: '🥗',
    })

    expect(result.slug).toBe('recetas-2')
  })
})

describe('createLibraryCategoryAction — autorización', () => {
  it('member común (no admin, no owner): AuthorizationError sin tocar create', async () => {
    mockActiveMember()

    await expect(
      createLibraryCategoryAction({
        placeId: PLACE_ID,
        title: 'Recetas',
        emoji: '🥗',
      }),
    ).rejects.toBeInstanceOf(AuthorizationError)

    expect(libraryCategoryCount).not.toHaveBeenCalled()
    expect(libraryCategoryCreate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })
})

describe('createLibraryCategoryAction — invariantes', () => {
  it('cap excedido: count >= MAX → CategoryLimitReachedError sin crear', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryCount.mockResolvedValue(MAX_CATEGORIES_PER_PLACE)

    await expect(
      createLibraryCategoryAction({
        placeId: PLACE_ID,
        title: 'Una más',
        emoji: '🥗',
      }),
    ).rejects.toBeInstanceOf(CategoryLimitReachedError)

    expect(libraryCategoryFindMany).not.toHaveBeenCalled()
    expect(libraryCategoryCreate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })

  it('cap igual a MAX-1: permite crear (boundary inferior)', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryCount.mockResolvedValue(MAX_CATEGORIES_PER_PLACE - 1)
    libraryCategoryFindMany.mockResolvedValue([])
    libraryCategoryCreate.mockResolvedValue({ id: NEW_CATEGORY_ID, slug: 'fin' })

    const result = await createLibraryCategoryAction({
      placeId: PLACE_ID,
      title: 'Fin',
      emoji: '🏁',
    })

    expect(result.ok).toBe(true)
  })
})

describe('createLibraryCategoryAction — errores estructurales', () => {
  it('input sin title: ValidationError sin tocar Prisma', async () => {
    await expect(
      createLibraryCategoryAction({ placeId: PLACE_ID, emoji: '🥗' }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(getUserFn).not.toHaveBeenCalled()
    expect(libraryCategoryCount).not.toHaveBeenCalled()
  })

  it('title vacío (string ""): ValidationError sin tocar Prisma', async () => {
    await expect(
      createLibraryCategoryAction({
        placeId: PLACE_ID,
        title: '',
        emoji: '🥗',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(libraryCategoryCount).not.toHaveBeenCalled()
  })

  it('title solo espacios: ValidationError (Zod refine post-trim)', async () => {
    await expect(
      createLibraryCategoryAction({
        placeId: PLACE_ID,
        title: '   ',
        emoji: '🥗',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(libraryCategoryCount).not.toHaveBeenCalled()
  })

  it('title supera 60 chars: ValidationError sin tocar Prisma', async () => {
    await expect(
      createLibraryCategoryAction({
        placeId: PLACE_ID,
        title: 'a'.repeat(61),
        emoji: '🥗',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(libraryCategoryCount).not.toHaveBeenCalled()
  })

  it('emoji vacío: ValidationError sin tocar Prisma', async () => {
    await expect(
      createLibraryCategoryAction({
        placeId: PLACE_ID,
        title: 'Recetas',
        emoji: '',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(libraryCategoryCount).not.toHaveBeenCalled()
  })

  it('emoji supera 8 chars: ValidationError sin tocar Prisma', async () => {
    await expect(
      createLibraryCategoryAction({
        placeId: PLACE_ID,
        title: 'Recetas',
        emoji: '🥗🥗🥗🥗🥗🥗🥗🥗🥗',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(libraryCategoryCount).not.toHaveBeenCalled()
  })

  it('placeId vacío: ValidationError sin tocar Prisma', async () => {
    await expect(
      createLibraryCategoryAction({
        placeId: '',
        title: 'Recetas',
        emoji: '🥗',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(getUserFn).not.toHaveBeenCalled()
  })

  it('P2002 unique violation en create: el error de Prisma propaga sin envolver', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryCount.mockResolvedValue(3)
    libraryCategoryFindMany.mockResolvedValue([])
    // Race condition: otro proceso insertó el slug entre findMany y create.
    const prismaError = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    })
    libraryCategoryCreate.mockRejectedValue(prismaError)

    await expect(
      createLibraryCategoryAction({
        placeId: PLACE_ID,
        title: 'Recetas',
        emoji: '🥗',
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    // No revalida si el create falló.
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })
})
