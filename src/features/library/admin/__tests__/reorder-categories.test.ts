import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, ConflictError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Tests para `reorderLibraryCategoriesAction` (R.7.2 — M3 batch).
 *
 * Patrón replicado de `archive-category.test.ts`:
 *  - Mocks granulares de Prisma por modelo + auxiliares.
 *  - `resolveActorForPlace` corre real, consume los mocks del wiring
 *    `auth → place → membership → ownership → user`.
 *  - `prisma.$transaction` ahora recibe un callback (`async tx => ...`).
 *    El callback corre el SET check (`tx.libraryCategory.findMany`),
 *    adquiere el advisory lock (`tx.$executeRaw`) y dispara los
 *    `tx.libraryCategory.update` en `Promise.all`. El mock invoca el
 *    callback con un `tx` que reusa los mismos fns que el cliente raíz.
 */

// ---------------------------------------------------------------
// Prisma + auxiliares mockeados
// ---------------------------------------------------------------

const libraryCategoryFindMany = vi.fn()
const libraryCategoryUpdate = vi.fn()
const transactionFn = vi.fn()
const txExecuteRaw = vi.fn()
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
      findMany: (...a: unknown[]) => libraryCategoryFindMany(...a),
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

import { reorderLibraryCategoriesAction } from '@/features/library/admin/server/actions/reorder-categories'
import { PERMISSIONS_ALL } from '@/features/groups/public'

// ---------------------------------------------------------------
// Fixtures + helper
// ---------------------------------------------------------------

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'the-place'
const USER_ID = 'user-1'

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

beforeEach(() => {
  vi.clearAllMocks()
  // Default: $transaction se invoca con un callback. El `tx` expone los
  // mismos primitives que el cliente raíz — `findMany`, `update` — más
  // `$executeRaw` para `acquireCategorySetLock`. El callback sincroniza
  // SET check + lock + updates bajo el lock advisory.
  transactionFn.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    if (typeof fn !== 'function') {
      throw new Error('reorder action espera forma callback de $transaction')
    }
    return fn({
      libraryCategory: {
        findMany: (...a: unknown[]) => libraryCategoryFindMany(...a),
        update: (...a: unknown[]) => libraryCategoryUpdate(...a),
      },
      $executeRaw: (...a: unknown[]) => txExecuteRaw(...a),
    })
  })
  txExecuteRaw.mockResolvedValue(1)
  // Cada update mockeado devuelve un objeto con el id que recibió.
  libraryCategoryUpdate.mockImplementation(async (args: { where: { id: string } }) => ({
    id: args.where.id,
  }))
})

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe('reorderLibraryCategoriesAction — happy path', () => {
  it('admin: 3 categorías reordenadas, TX con N updates + revalida paths', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindMany.mockResolvedValue([{ id: 'cat-a' }, { id: 'cat-b' }, { id: 'cat-c' }])

    const result = await reorderLibraryCategoriesAction({
      placeId: PLACE_ID,
      orderedCategoryIds: ['cat-c', 'cat-a', 'cat-b'],
    })

    expect(result).toEqual({ ok: true, updated: 3 })

    // findMany usado para chequear set match contra live IDs (ahora vive
    // dentro de la TX bajo el advisory lock).
    expect(libraryCategoryFindMany).toHaveBeenCalledWith({
      where: { placeId: PLACE_ID, archivedAt: null },
      select: { id: true },
    })

    // TX llamada exactamente una vez.
    expect(transactionFn).toHaveBeenCalledTimes(1)

    // Lock advisory adquirido antes del SET check + UPDATEs — soft
    // assertion sobre el SQL para verificar el wiring del helper.
    expect(txExecuteRaw).toHaveBeenCalled()
    const lockCallSql = JSON.stringify(txExecuteRaw.mock.calls[0])
    expect(lockCallSql).toContain('pg_advisory_xact_lock')

    // Cada update recibe el id del array y la posición = index.
    expect(libraryCategoryUpdate).toHaveBeenCalledTimes(3)
    expect(libraryCategoryUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 'cat-c' },
      data: { position: 0 },
    })
    expect(libraryCategoryUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 'cat-a' },
      data: { position: 1 },
    })
    expect(libraryCategoryUpdate).toHaveBeenNthCalledWith(3, {
      where: { id: 'cat-b' },
      data: { position: 2 },
    })

    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/library`)
  })

  it('owner sin rol ADMIN: ownership row alcanza para reordenar', async () => {
    mockActiveMember({ isOwner: true })
    libraryCategoryFindMany.mockResolvedValue([{ id: 'cat-a' }, { id: 'cat-b' }])

    const result = await reorderLibraryCategoriesAction({
      placeId: PLACE_ID,
      orderedCategoryIds: ['cat-b', 'cat-a'],
    })

    expect(result).toEqual({ ok: true, updated: 2 })
    expect(transactionFn).toHaveBeenCalledTimes(1)
    expect(libraryCategoryUpdate).toHaveBeenCalledTimes(2)
  })
})

describe('reorderLibraryCategoriesAction — autorización', () => {
  it('member común (no admin, no owner): AuthorizationError sin tocar findMany ni TX', async () => {
    mockActiveMember()

    await expect(
      reorderLibraryCategoriesAction({
        placeId: PLACE_ID,
        orderedCategoryIds: ['cat-a', 'cat-b'],
      }),
    ).rejects.toBeInstanceOf(AuthorizationError)

    expect(libraryCategoryFindMany).not.toHaveBeenCalled()
    expect(transactionFn).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })
})

describe('reorderLibraryCategoriesAction — set mismatch (ConflictError)', () => {
  // El SET check ahora vive DENTRO de la TX bajo el advisory lock, así
  // que `transactionFn` SÍ se invoca (el callback corre, falla, la TX
  // hace rollback y se libera el lock). Lo que NO debe correr son los
  // UPDATEs.
  it('inputIds incluye una categoría que no existe en live → ConflictError', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindMany.mockResolvedValue([{ id: 'cat-a' }, { id: 'cat-b' }])

    await expect(
      reorderLibraryCategoriesAction({
        placeId: PLACE_ID,
        // 'cat-ghost' no está en live.
        orderedCategoryIds: ['cat-a', 'cat-ghost'],
      }),
    ).rejects.toBeInstanceOf(ConflictError)

    expect(transactionFn).toHaveBeenCalledTimes(1)
    expect(libraryCategoryUpdate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })

  it('liveIds tiene una categoría no presente en input → ConflictError (input incompleto)', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindMany.mockResolvedValue([{ id: 'cat-a' }, { id: 'cat-b' }, { id: 'cat-c' }])

    await expect(
      reorderLibraryCategoriesAction({
        placeId: PLACE_ID,
        // Falta 'cat-c' — admin agregó una categoría mientras el cliente
        // tenía un drag abierto.
        orderedCategoryIds: ['cat-a', 'cat-b'],
      }),
    ).rejects.toBeInstanceOf(ConflictError)

    expect(transactionFn).toHaveBeenCalledTimes(1)
    expect(libraryCategoryUpdate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })
})

describe('reorderLibraryCategoriesAction — TOCTOU cerrado vía advisory lock', () => {
  // Bug latente HIGH (cerrado):
  // El `findMany` (live IDs) y los `update(...)` ahora corren DENTRO del
  // mismo `prisma.$transaction(async tx => …)`, bajo `acquireCategorySetLock`
  // que toma `pg_advisory_xact_lock(1, hashtext(placeId))`. Esto garantiza
  // que entre el SET check y los UPDATEs, ninguna otra TX del mismo place
  // pueda crear/archivar categorías — los otros writers se serializan
  // detrás del lock.
  //
  // El test valida la semántica correcta: si el `findMany` corre DENTRO
  // de la TX y devuelve un set distinto al input, la action lanza
  // `ConflictError`. Esto demuestra que el SET check ahora es transaccional,
  // no un check externo stale.
  it('SET check dentro de la TX: si findMany retorna un set distinto al input, throws ConflictError bajo el lock', async () => {
    mockActiveMember({ asAdmin: true })
    // Simulamos el escenario que antes era TOCTOU: el cliente envía un
    // input basado en una vista vieja, y al momento de la TX el live set
    // del DB ya es distinto. Ahora ese check corre transaccionalmente
    // (mismo `tx` que los UPDATEs) bajo el advisory lock.
    libraryCategoryFindMany.mockResolvedValue([
      { id: 'cat-a' },
      { id: 'cat-b' },
      // Un admin paralelo agregó 'cat-new' antes de que entráramos a
      // la TX — el lock lo serializa pero el SET check detecta el delta.
      { id: 'cat-new' },
    ])

    await expect(
      reorderLibraryCategoriesAction({
        placeId: PLACE_ID,
        orderedCategoryIds: ['cat-a', 'cat-b'],
      }),
    ).rejects.toBeInstanceOf(ConflictError)

    // La TX se llamó (callback abrió, lock se adquirió, findMany corrió)
    // pero ningún UPDATE se ejecutó porque el SET mismatch aborta antes.
    expect(transactionFn).toHaveBeenCalledTimes(1)
    expect(txExecuteRaw).toHaveBeenCalled()
    const lockCallSql = JSON.stringify(txExecuteRaw.mock.calls[0])
    expect(lockCallSql).toContain('pg_advisory_xact_lock')
    expect(libraryCategoryFindMany).toHaveBeenCalledTimes(1)
    expect(libraryCategoryUpdate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })
})

describe('reorderLibraryCategoriesAction — ValidationError', () => {
  it('orderedCategoryIds vacío: ValidationError sin tocar Prisma', async () => {
    await expect(
      reorderLibraryCategoriesAction({
        placeId: PLACE_ID,
        orderedCategoryIds: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(getUserFn).not.toHaveBeenCalled()
    expect(libraryCategoryFindMany).not.toHaveBeenCalled()
    expect(transactionFn).not.toHaveBeenCalled()
  })

  it('placeId vacío: ValidationError sin tocar Prisma', async () => {
    await expect(
      reorderLibraryCategoriesAction({
        placeId: '',
        orderedCategoryIds: ['cat-a'],
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(libraryCategoryFindMany).not.toHaveBeenCalled()
    expect(transactionFn).not.toHaveBeenCalled()
  })

  it('orderedCategoryIds con id vacío: ValidationError sin tocar Prisma', async () => {
    await expect(
      reorderLibraryCategoriesAction({
        placeId: PLACE_ID,
        orderedCategoryIds: ['cat-a', ''],
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(libraryCategoryFindMany).not.toHaveBeenCalled()
    expect(transactionFn).not.toHaveBeenCalled()
  })
})
