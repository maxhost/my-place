import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'

/**
 * Test para `createLibraryItemAction` (R.7.2 — pilot M3).
 *
 * Replica el patrón de `archive-category.test.ts` + suma:
 *  1. Mock de `prisma.$transaction` con un `tx` mock que tenga
 *     `libraryItem.create` (Post.create se ejerce vía
 *     `createPostFromSystemHelper`, que mockeamos directo para no
 *     reimplementar el slug-resolver bajo tx).
 *  2. Mock de `assertPlaceOpenOrThrow` (`@/features/hours/public.server`).
 *  3. Mock de `listCategoryContributorUserIds`
 *     (`@/features/library/server/queries`).
 *  4. Mock de `createPostFromSystemHelper`
 *     (`@/features/discussions/public.server`).
 *
 * `resolveActorForPlace` corre real, igual que en archive-category, y
 * consume las primitives de Prisma + Supabase mockeadas. Eso da
 * cobertura del wiring `auth → place → membership → ownership → user`.
 *
 * Bug latente (#7) — Post huérfano por race entre check y INSERT
 * (CONTEXTO HISTÓRICO: el fix llegó, ver test de race más abajo):
 * la action lee la categoría con `prisma.libraryCategory.findUnique`
 * **fuera** del `prisma.$transaction(...)`. Si la categoría se borra o
 * se archiva entre ese read y el `tx.libraryItem.create`, el Post se
 * crea pero el LibraryItem falla con un FK error genérico — sin error
 * tipado, y dejando un Post huérfano (sin LibraryItem) salvo que el
 * rollback de la tx alcance también al Post (sí alcanza, porque la
 * tx envuelve `createPostFromSystemHelper(tx, …)` + `tx.libraryItem.create`).
 *
 * Lo que NO prevenía el código original: que el chequeo `archivedAt: null`
 * se vuelva stale y se intente crear un item bajo una categoría archivada
 * en carrera. El fix actual wrappea el `$transaction` y convierte el
 * `P2003` crudo de Prisma en `ConflictError` tipado, así la UI puede
 * pedir reload + reintento sin exponer el código de Prisma.
 */

// ---------------------------------------------------------------
// Prisma + auxiliares mockeados
// ---------------------------------------------------------------

const libraryCategoryFindUnique = vi.fn()
const placeFindUnique = vi.fn()
const membershipFindFirst = vi.fn()
const ownershipFindUnique = vi.fn()
const userFindUnique = vi.fn()
const transactionFn = vi.fn()
const txLibraryItemCreate = vi.fn()
const getUserFn = vi.fn()
const revalidatePathFn = vi.fn()
const assertPlaceOpenFn = vi.fn()
const listContributorsFn = vi.fn()
const createPostFromSystemHelperFn = vi.fn()
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
    libraryCategory: {
      findUnique: (...a: unknown[]) => libraryCategoryFindUnique(...a),
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
    $transaction: (fn: (tx: unknown) => unknown) => transactionFn(fn),
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

vi.mock('@/features/hours/public.server', () => ({
  assertPlaceOpenOrThrow: (...a: unknown[]) => assertPlaceOpenFn(...a),
  findPlaceHours: vi.fn(async () => ({ kind: 'always_open' })),
}))

// `createPostFromSystemHelper` se mockea desde la superficie pública
// `public.server.ts` — la action lo consume vía ese entry. El mock
// también re-exporta `resolveActorForPlace` para que el wiring real
// del actor siga funcionando bajo los mocks de Prisma + Supabase ya
// definidos arriba.
vi.mock('@/features/discussions/public.server', async () => {
  const real = await vi.importActual<typeof import('@/features/discussions/public.server')>(
    '@/features/discussions/public.server',
  )
  return {
    ...real,
    createPostFromSystemHelper: (...a: unknown[]) => createPostFromSystemHelperFn(...a),
  }
})

vi.mock('@/features/library/contributors/server/queries', () => ({
  listCategoryContributorUserIds: (...a: unknown[]) => listContributorsFn(...a),
}))

// ---------------------------------------------------------------
// Imports después del setup (hoisting de vi.mock)
// ---------------------------------------------------------------

import { createLibraryItemAction } from '@/features/library/items/server/actions/create-item'
import { PERMISSIONS_ALL } from '@/features/groups/public'

// ---------------------------------------------------------------
// Fixtures + helper
// ---------------------------------------------------------------

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'the-place'
const USER_ID = 'user-1'
const OTHER_USER_ID = 'user-2'
const CATEGORY_ID = 'cat-1'
const CATEGORY_SLUG = 'recetas'
const POST_ID = 'post-1'
const POST_SLUG = 'pan-de-campo'
const ITEM_ID = 'item-1'

const validBody = {
  root: {
    type: 'root' as const,
    version: 1 as const,
    format: '' as const,
    indent: 0,
    direction: 'ltr' as const,
    children: [
      {
        type: 'paragraph' as const,
        version: 1 as const,
        format: '' as const,
        indent: 0,
        direction: 'ltr' as const,
        textFormat: 0,
        textStyle: '',
        children: [
          {
            type: 'text' as const,
            version: 1 as const,
            text: 'receta',
            format: 0,
            detail: 0,
            mode: 'normal' as const,
            style: '',
          },
        ],
      },
    ],
  },
}

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
 *
 * También cablea el `prisma.$transaction` mock para que invoque el
 * callback con un `tx` que expone `libraryItem.create`. El otro
 * consumer del tx (`createPostFromSystemHelper`) está mockeado
 * directamente, así que no necesita primitives bajo tx.
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
  assertPlaceOpenFn.mockResolvedValue(undefined)
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
  transactionFn.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({
      libraryItem: { create: txLibraryItemCreate },
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    placeId: PLACE_ID,
    categoryId: CATEGORY_ID,
    title: 'Pan de campo',
    body: validBody,
    coverUrl: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe('createLibraryItemAction — happy paths', () => {
  it('admin: categoría MEMBERS_OPEN crea Post + LibraryItem y revalida los 4 paths', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      slug: CATEGORY_SLUG,
      placeId: PLACE_ID,
      contributionPolicy: 'MEMBERS_OPEN',
      groupScopes: [],
      archivedAt: null,
    })
    createPostFromSystemHelperFn.mockResolvedValue({ id: POST_ID, slug: POST_SLUG })
    txLibraryItemCreate.mockResolvedValue({ id: ITEM_ID })

    const result = await createLibraryItemAction(validInput())

    expect(result).toEqual({
      ok: true,
      itemId: ITEM_ID,
      postSlug: POST_SLUG,
      categorySlug: CATEGORY_SLUG,
    })
    // El admin no necesita lookup de contributors (policy = MEMBERS_OPEN
    // nunca consulta DESIGNATED, y aunque consultase, isAdmin gana antes).
    expect(listContributorsFn).not.toHaveBeenCalled()
    expect(createPostFromSystemHelperFn).toHaveBeenCalledTimes(1)
    expect(txLibraryItemCreate).toHaveBeenCalledTimes(1)
    expect(txLibraryItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          placeId: PLACE_ID,
          categoryId: CATEGORY_ID,
          postId: POST_ID,
          authorUserId: USER_ID,
          // Snapshot denormalizado del autor — patrón Post/Comment/Event.
          // Erasure 365d nullifica `authorUserId` y reescribe el snapshot.
          authorSnapshot: { displayName: 'Max', avatarUrl: null },
          coverUrl: null,
        }),
      }),
    )
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library/${CATEGORY_SLUG}`)
    expect(revalidatePathFn).toHaveBeenCalledWith(
      `/${PLACE_SLUG}/library/${CATEGORY_SLUG}/${POST_SLUG}`,
    )
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/conversations`)
  })

  it('member en MEMBERS_OPEN: pasa el gate sin necesitar contributors', async () => {
    mockActiveMember()
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      slug: CATEGORY_SLUG,
      placeId: PLACE_ID,
      contributionPolicy: 'MEMBERS_OPEN',
      groupScopes: [],
      archivedAt: null,
    })
    createPostFromSystemHelperFn.mockResolvedValue({ id: POST_ID, slug: POST_SLUG })
    txLibraryItemCreate.mockResolvedValue({ id: ITEM_ID })

    const result = await createLibraryItemAction(validInput())

    expect(result.ok).toBe(true)
    expect(listContributorsFn).not.toHaveBeenCalled()
    expect(txLibraryItemCreate).toHaveBeenCalledTimes(1)
  })

  it('designated contributor (member sin ADMIN) en DESIGNATED: pasa el gate', async () => {
    mockActiveMember()
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      slug: CATEGORY_SLUG,
      placeId: PLACE_ID,
      contributionPolicy: 'DESIGNATED',
      groupScopes: [],
      archivedAt: null,
    })
    listContributorsFn.mockResolvedValue([USER_ID, OTHER_USER_ID])
    createPostFromSystemHelperFn.mockResolvedValue({ id: POST_ID, slug: POST_SLUG })
    txLibraryItemCreate.mockResolvedValue({ id: ITEM_ID })

    const result = await createLibraryItemAction(validInput())

    expect(result.ok).toBe(true)
    expect(listContributorsFn).toHaveBeenCalledWith(CATEGORY_ID)
    expect(txLibraryItemCreate).toHaveBeenCalledTimes(1)
  })

  it('coverUrl válida (https): se persiste tal cual al LibraryItem', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      slug: CATEGORY_SLUG,
      placeId: PLACE_ID,
      contributionPolicy: 'MEMBERS_OPEN',
      groupScopes: [],
      archivedAt: null,
    })
    createPostFromSystemHelperFn.mockResolvedValue({ id: POST_ID, slug: POST_SLUG })
    txLibraryItemCreate.mockResolvedValue({ id: ITEM_ID })

    await createLibraryItemAction(validInput({ coverUrl: 'https://images.example.com/pan.jpg' }))

    expect(txLibraryItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          coverUrl: 'https://images.example.com/pan.jpg',
        }),
      }),
    )
  })
})

describe('createLibraryItemAction — autorización', () => {
  it('member en DESIGNATED sin contributor row: AuthorizationError sin tocar la tx', async () => {
    mockActiveMember()
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      slug: CATEGORY_SLUG,
      placeId: PLACE_ID,
      contributionPolicy: 'DESIGNATED',
      groupScopes: [],
      archivedAt: null,
    })
    listContributorsFn.mockResolvedValue([OTHER_USER_ID])

    await expect(createLibraryItemAction(validInput())).rejects.toBeInstanceOf(AuthorizationError)

    expect(transactionFn).not.toHaveBeenCalled()
    expect(createPostFromSystemHelperFn).not.toHaveBeenCalled()
    expect(txLibraryItemCreate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })

  it('member en SELECTED_GROUPS sin scope asignado: AuthorizationError (default cerrado)', async () => {
    mockActiveMember()
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      slug: CATEGORY_SLUG,
      placeId: PLACE_ID,
      contributionPolicy: 'SELECTED_GROUPS',
      groupScopes: [],
      archivedAt: null,
    })

    await expect(createLibraryItemAction(validInput())).rejects.toBeInstanceOf(AuthorizationError)

    expect(transactionFn).not.toHaveBeenCalled()
    expect(txLibraryItemCreate).not.toHaveBeenCalled()
  })
})

describe('createLibraryItemAction — validación', () => {
  it('title vacío (solo whitespace): ValidationError sin tocar Prisma de dominio', async () => {
    await expect(createLibraryItemAction(validInput({ title: '   ' }))).rejects.toBeInstanceOf(
      ValidationError,
    )

    expect(libraryCategoryFindUnique).not.toHaveBeenCalled()
    expect(transactionFn).not.toHaveBeenCalled()
  })

  it('title que supera POST_TITLE_MAX_LENGTH: ValidationError', async () => {
    const tooLong = 'x'.repeat(500)
    await expect(createLibraryItemAction(validInput({ title: tooLong }))).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(libraryCategoryFindUnique).not.toHaveBeenCalled()
  })

  it('coverUrl no http(s): ValidationError después del actor pero antes de la tx', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      slug: CATEGORY_SLUG,
      placeId: PLACE_ID,
      contributionPolicy: 'MEMBERS_OPEN',
      groupScopes: [],
      archivedAt: null,
    })

    await expect(
      createLibraryItemAction(validInput({ coverUrl: 'javascript:alert(1)' })),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(transactionFn).not.toHaveBeenCalled()
    expect(createPostFromSystemHelperFn).not.toHaveBeenCalled()
    expect(txLibraryItemCreate).not.toHaveBeenCalled()
  })

  it('input sin categoryId: ValidationError sin tocar Prisma', async () => {
    await expect(createLibraryItemAction(validInput({ categoryId: '' }))).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(libraryCategoryFindUnique).not.toHaveBeenCalled()
  })
})

describe('createLibraryItemAction — errores estructurales', () => {
  it('categoryId inexistente: NotFoundError sin entrar a la tx', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue(null)

    await expect(createLibraryItemAction(validInput())).rejects.toBeInstanceOf(NotFoundError)

    expect(transactionFn).not.toHaveBeenCalled()
    expect(createPostFromSystemHelperFn).not.toHaveBeenCalled()
    expect(txLibraryItemCreate).not.toHaveBeenCalled()
  })

  it('categoría de otro place: NotFoundError (anti cross-place)', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      slug: CATEGORY_SLUG,
      placeId: 'place-OTHER',
      contributionPolicy: 'MEMBERS_OPEN',
      groupScopes: [],
      archivedAt: null,
    })

    await expect(createLibraryItemAction(validInput())).rejects.toBeInstanceOf(NotFoundError)

    expect(transactionFn).not.toHaveBeenCalled()
  })

  it('categoría archivada al momento del check: NotFoundError sin entrar a la tx', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      slug: CATEGORY_SLUG,
      placeId: PLACE_ID,
      contributionPolicy: 'MEMBERS_OPEN',
      groupScopes: [],
      archivedAt: new Date('2026-04-01T12:00:00Z'),
    })

    await expect(createLibraryItemAction(validInput())).rejects.toBeInstanceOf(NotFoundError)

    expect(transactionFn).not.toHaveBeenCalled()
    expect(createPostFromSystemHelperFn).not.toHaveBeenCalled()
  })
})

describe('createLibraryItemAction — atomicidad y errores en tx', () => {
  /**
   * Bug histórico (cerrado): si la categoría se archiva/borra **entre** el
   * `findUnique` (línea 57 de la action) y el `tx.libraryItem.create`,
   * el read del check se vuelve stale. La tx envuelve Post + LibraryItem,
   * así que un fallo del segundo INSERT rollbackea el primero — no hay
   * Post huérfano físicamente. Antes del fix, la action propagaba el
   * error crudo de Prisma (P2003 FK violation), y la UI lo mostraba como
   * friendly genérico sin contexto.
   *
   * Fix: el `$transaction` se wrappea en try/catch y convierte el
   * `Prisma.PrismaClientKnownRequestError` con código `P2003` en
   * `ConflictError` tipado, con `categoryId` + `placeId` en el contexto.
   * Esto deja a la UI pedir reload + reintento de manera consistente
   * con el resto del slice.
   *
   * Mitigación SQL adicional: el RLS + CHECK constraints de la
   * migration 20260430000000 también cortan a nivel Postgres.
   */
  it('race condition: categoría borrada entre check y create — convierte P2003 en ConflictError tipado', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      slug: CATEGORY_SLUG,
      placeId: PLACE_ID,
      contributionPolicy: 'MEMBERS_OPEN',
      groupScopes: [],
      archivedAt: null,
    })
    createPostFromSystemHelperFn.mockResolvedValue({ id: POST_ID, slug: POST_SLUG })
    // FK violation: categoryId ya no existe al momento del INSERT.
    txLibraryItemCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('FK constraint failed', {
        code: 'P2003',
        clientVersion: 'test',
      }),
    )

    await expect(createLibraryItemAction(validInput())).rejects.toBeInstanceOf(ConflictError)
    // Confirmá que el revalidate NO se llama: la tx falló y la action
    // no llega al final. El Post se intentó crear (no hay Post huérfano
    // porque la tx rollbackea), pero un read del DB diría que falló todo.
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })

  it('P2002 colisión de slug en post: createPostFromSystemHelper lanza ConflictError y la action lo propaga', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      slug: CATEGORY_SLUG,
      placeId: PLACE_ID,
      contributionPolicy: 'MEMBERS_OPEN',
      groupScopes: [],
      archivedAt: null,
    })
    // El helper ya hace un retry interno; tras dos colisiones, tira
    // `ConflictError`. La action no lo wrappea — lo propaga tal cual.
    createPostFromSystemHelperFn.mockRejectedValue(
      new ConflictError('No pudimos asignar una URL única para el thread del evento.', {
        placeId: PLACE_ID,
        title: 'Pan de campo',
        originSystem: 'library_item',
        originId: 'pending',
      }),
    )

    await expect(createLibraryItemAction(validInput())).rejects.toBeInstanceOf(ConflictError)

    // El INSERT del LibraryItem nunca corre porque el Post falló primero.
    expect(txLibraryItemCreate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })
})
