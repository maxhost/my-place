import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Test plantilla para acciones del slice `library` (R.7.2 — pilot M3).
 *
 * Patrón replicable por las otras 8 actions del slice:
 *  1. Mocks granulares de Prisma por modelo (libraryCategory + identidad).
 *  2. Mock de Supabase auth (`createSupabaseServer`) y de `next/cache`.
 *  3. Helper local `mockActiveMember(role, opts)` inline — no compartido.
 *  4. `vi.clearAllMocks()` en `beforeEach`.
 *  5. Imports de la action al final, después de los `vi.mock` (hoisting).
 *
 * `resolveActorForPlace` no se mockea: corre real y consume las primitives
 * de Prisma + Supabase ya mockeadas. Eso da cobertura realista del wiring
 * `auth → place → membership → ownership → user` sin acoplar al detalle.
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
const transactionFn = vi.fn()
const txExecuteRaw = vi.fn()

// G.3: hasPermission cae a `prisma.groupMembership.findMany` cuando el
// fallback role===ADMIN no aplica. Default [] (sin grupos) preserva el
// comportamiento "member sin permisos" de los tests pre-G.3.
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

import { archiveLibraryCategoryAction } from '@/features/library/admin/server/actions/archive-category'
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
  // El callback `$transaction` recibe un `tx` con `libraryCategory.update`
  // y `$executeRaw` (para `acquireCategorySetLock`).
  transactionFn.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({
      libraryCategory: {
        update: (...a: unknown[]) => libraryCategoryUpdate(...a),
      },
      $executeRaw: (...a: unknown[]) => txExecuteRaw(...a),
    }),
  )
  txExecuteRaw.mockResolvedValue(1)
})

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe('archiveLibraryCategoryAction — happy paths', () => {
  it('admin: archiva categoría no archivada y revalida los 3 paths', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
      archivedAt: null,
    })
    libraryCategoryUpdate.mockResolvedValue({ id: CATEGORY_ID })

    const result = await archiveLibraryCategoryAction({ categoryId: CATEGORY_ID })

    expect(result).toEqual({
      ok: true,
      categoryId: CATEGORY_ID,
      alreadyArchived: false,
    })
    // Lock advisory adquirido antes del UPDATE — soft assertion sobre el
    // SQL para confirmar que la action consume `acquireCategorySetLock`.
    expect(transactionFn).toHaveBeenCalledTimes(1)
    expect(txExecuteRaw).toHaveBeenCalled()
    const lockCallSql = JSON.stringify(txExecuteRaw.mock.calls[0])
    expect(lockCallSql).toContain('pg_advisory_xact_lock')
    expect(libraryCategoryUpdate).toHaveBeenCalledTimes(1)
    expect(libraryCategoryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CATEGORY_ID },
        data: expect.objectContaining({ archivedAt: expect.any(Date) }),
      }),
    )
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library/${CATEGORY_SLUG}`)
  })

  it('owner sin rol ADMIN: ownership row alcanza para archivar', async () => {
    mockActiveMember({ isOwner: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
      archivedAt: null,
    })
    libraryCategoryUpdate.mockResolvedValue({ id: CATEGORY_ID })

    const result = await archiveLibraryCategoryAction({ categoryId: CATEGORY_ID })

    expect(result.ok).toBe(true)
    expect(result.alreadyArchived).toBe(false)
    expect(ownershipFindUnique).toHaveBeenCalled()
    expect(libraryCategoryUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('archiveLibraryCategoryAction — idempotencia', () => {
  it('categoría ya archivada: no llama update ni revalidate y devuelve alreadyArchived=true', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
      archivedAt: new Date('2026-04-01T12:00:00Z'),
    })

    const result = await archiveLibraryCategoryAction({ categoryId: CATEGORY_ID })

    expect(result).toEqual({
      ok: true,
      categoryId: CATEGORY_ID,
      alreadyArchived: true,
    })
    expect(libraryCategoryUpdate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })
})

describe('archiveLibraryCategoryAction — autorización', () => {
  it('member común (no admin, no owner): AuthorizationError sin tocar update', async () => {
    mockActiveMember()
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
      archivedAt: null,
    })

    await expect(archiveLibraryCategoryAction({ categoryId: CATEGORY_ID })).rejects.toBeInstanceOf(
      AuthorizationError,
    )

    expect(libraryCategoryUpdate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })
})

describe('archiveLibraryCategoryAction — errores estructurales', () => {
  it('categoría inexistente: NotFoundError antes de resolver actor', async () => {
    libraryCategoryFindUnique.mockResolvedValue(null)

    await expect(
      archiveLibraryCategoryAction({ categoryId: 'cat-missing' }),
    ).rejects.toBeInstanceOf(NotFoundError)

    // Short-circuit: no se intenta resolver actor ni queries posteriores.
    expect(getUserFn).not.toHaveBeenCalled()
    expect(placeFindUnique).not.toHaveBeenCalled()
    expect(libraryCategoryUpdate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })

  it('input sin categoryId: ValidationError sin tocar Prisma', async () => {
    await expect(archiveLibraryCategoryAction({})).rejects.toBeInstanceOf(ValidationError)
    expect(libraryCategoryFindUnique).not.toHaveBeenCalled()
  })

  it('input con categoryId vacío: ValidationError sin tocar Prisma', async () => {
    await expect(archiveLibraryCategoryAction({ categoryId: '' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(libraryCategoryFindUnique).not.toHaveBeenCalled()
  })
})
