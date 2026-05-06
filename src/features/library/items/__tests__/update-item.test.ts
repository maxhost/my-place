import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'

/**
 * Test para `updateLibraryItemAction` (R.7.2 — pilot M3).
 *
 * Replica el patrón de `archive-category.test.ts` y `archive-item.test.ts`:
 *  1. Mocks granulares de Prisma por modelo (libraryItem.findUnique +
 *     `$transaction` que invoca el callback con un `tx` que expone
 *     `post.update` y `libraryItem.update`).
 *  2. Mock de Supabase auth (`createSupabaseServer`) y de `next/cache`.
 *  3. Helper local `mockActiveMember(role, opts)` inline — no compartido.
 *  4. `vi.clearAllMocks()` en `beforeEach`.
 *  5. Imports de la action al final, después de los `vi.mock` (hoisting).
 *
 * `resolveActorForPlace` no se mockea: corre real y consume las primitives
 * de Prisma + Supabase ya mockeadas. Cubre el wiring completo
 * `auth → place → membership → ownership → user` sin acoplar al detalle.
 */

// ---------------------------------------------------------------
// Prisma + auxiliares mockeados
// ---------------------------------------------------------------

const libraryItemFindUnique = vi.fn()
const libraryItemUpdate = vi.fn()
const postUpdateMany = vi.fn()
const transactionFn = vi.fn()
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
    post: { updateMany: (...a: unknown[]) => postUpdateMany(...a) },
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

import { updateLibraryItemAction } from '@/features/library/items/server/actions/update-item'
import { PERMISSIONS_ALL } from '@/features/groups/public'

// ---------------------------------------------------------------
// Fixtures + helper
// ---------------------------------------------------------------

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'the-place'
const USER_ID = 'user-1'
const OTHER_USER_ID = 'user-2'
const ITEM_ID = 'item-1'
const POST_ID = 'po-1'
const CATEGORY_ID = 'cat-1'
const CATEGORY_SLUG = 'recetas'
const POST_SLUG = 'pan-de-campo'

const VALID_BODY = {
  type: 'doc' as const,
  content: [
    {
      type: 'paragraph' as const,
      content: [{ type: 'text' as const, text: 'cuerpo actualizado' }],
    },
  ],
}

const VALID_TITLE = 'Pan de campo (v2)'
const VALID_COVER = 'https://images.example.com/pan.jpg'

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
 *
 * También wirea `$transaction` a un `tx` con `post.update` y
 * `libraryItem.update` apuntando a los mocks de afuera.
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
  transactionFn.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({
      post: { updateMany: postUpdateMany },
      libraryItem: { update: libraryItemUpdate },
    }),
  )
}

function itemFixture(overrides: Partial<{ authorUserId: string }> = {}) {
  return {
    id: ITEM_ID,
    placeId: PLACE_ID,
    authorUserId: overrides.authorUserId ?? USER_ID,
    categoryId: CATEGORY_ID,
    category: { slug: CATEGORY_SLUG },
    post: { id: POST_ID, slug: POST_SLUG },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe('updateLibraryItemAction — happy paths', () => {
  it('author: actualiza title/body/coverUrl, bumpea version del Post (optimistic) y revalida paths del item', async () => {
    mockActiveMember()
    libraryItemFindUnique.mockResolvedValue(itemFixture({ authorUserId: USER_ID }))
    postUpdateMany.mockResolvedValue({ count: 1 })
    libraryItemUpdate.mockResolvedValue({ id: ITEM_ID })

    const result = await updateLibraryItemAction({
      itemId: ITEM_ID,
      title: VALID_TITLE,
      body: VALID_BODY,
      coverUrl: VALID_COVER,
      expectedVersion: 7,
    })

    expect(result).toEqual({
      ok: true,
      itemId: ITEM_ID,
      postSlug: POST_SLUG,
      categorySlug: CATEGORY_SLUG,
      version: 8,
    })
    // Tx ejecutada exactamente una vez con los dos updates dentro.
    expect(transactionFn).toHaveBeenCalledTimes(1)
    expect(postUpdateMany).toHaveBeenCalledTimes(1)
    expect(postUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: POST_ID, version: 7 },
        data: expect.objectContaining({
          title: VALID_TITLE,
          body: VALID_BODY,
          editedAt: expect.any(Date),
          version: 8,
        }),
      }),
    )
    expect(libraryItemUpdate).toHaveBeenCalledTimes(1)
    expect(libraryItemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ITEM_ID },
        data: { coverUrl: VALID_COVER },
      }),
    )
    // Revalidación: `/library`, `/library/[cat]`, `/library/[cat]/[postSlug]`,
    // `/conversations` y `/conversations/[postSlug]` (este último es harmless
    // porque la ruta hace `permanentRedirect` al item; lo dispara el helper
    // compartido `revalidateLibraryItemPaths` para invalidar el cache del 308).
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library/${CATEGORY_SLUG}`)
    expect(revalidatePathFn).toHaveBeenCalledWith(
      `/${PLACE_SLUG}/library/${CATEGORY_SLUG}/${POST_SLUG}`,
    )
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/conversations`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/conversations/${POST_SLUG}`)
  })

  it('admin no-author: tiene permiso de editar y actualiza el item', async () => {
    mockActiveMember({ asAdmin: true })
    libraryItemFindUnique.mockResolvedValue(itemFixture({ authorUserId: OTHER_USER_ID }))
    postUpdateMany.mockResolvedValue({ count: 1 })
    libraryItemUpdate.mockResolvedValue({ id: ITEM_ID })

    const result = await updateLibraryItemAction({
      itemId: ITEM_ID,
      title: VALID_TITLE,
      body: VALID_BODY,
      coverUrl: null,
      expectedVersion: 0,
    })

    expect(result.ok).toBe(true)
    expect(result.itemId).toBe(ITEM_ID)
    expect(postUpdateMany).toHaveBeenCalledTimes(1)
    expect(libraryItemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ITEM_ID },
        data: { coverUrl: null },
      }),
    )
  })

  it('owner sin rol ADMIN: ownership row alcanza para editar item ajeno', async () => {
    mockActiveMember({ isOwner: true })
    libraryItemFindUnique.mockResolvedValue(itemFixture({ authorUserId: OTHER_USER_ID }))
    postUpdateMany.mockResolvedValue({ count: 1 })
    libraryItemUpdate.mockResolvedValue({ id: ITEM_ID })

    const result = await updateLibraryItemAction({
      itemId: ITEM_ID,
      title: VALID_TITLE,
      body: VALID_BODY,
      coverUrl: VALID_COVER,
      expectedVersion: 0,
    })

    expect(result.ok).toBe(true)
    expect(ownershipFindUnique).toHaveBeenCalled()
    expect(postUpdateMany).toHaveBeenCalledTimes(1)
    expect(libraryItemUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('updateLibraryItemAction — autorización', () => {
  it('member no-author no-admin: AuthorizationError sin tocar Post ni Item', async () => {
    mockActiveMember()
    libraryItemFindUnique.mockResolvedValue(itemFixture({ authorUserId: OTHER_USER_ID }))

    await expect(
      updateLibraryItemAction({
        itemId: ITEM_ID,
        title: VALID_TITLE,
        body: VALID_BODY,
        coverUrl: VALID_COVER,
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError)

    expect(transactionFn).not.toHaveBeenCalled()
    expect(postUpdateMany).not.toHaveBeenCalled()
    expect(libraryItemUpdate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })
})

describe('updateLibraryItemAction — validación', () => {
  it('título vacío (whitespace): ValidationError sin tocar Prisma', async () => {
    await expect(
      updateLibraryItemAction({
        itemId: ITEM_ID,
        title: '   ',
        body: VALID_BODY,
        coverUrl: VALID_COVER,
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(libraryItemFindUnique).not.toHaveBeenCalled()
    expect(postUpdateMany).not.toHaveBeenCalled()
  })

  it('coverUrl con protocolo inválido: ValidationError tras pasar Zod (validateItemCoverUrl falla)', async () => {
    mockActiveMember()
    libraryItemFindUnique.mockResolvedValue(itemFixture({ authorUserId: USER_ID }))

    await expect(
      updateLibraryItemAction({
        itemId: ITEM_ID,
        title: VALID_TITLE,
        body: VALID_BODY,
        coverUrl: 'ftp://malicious.example.com/img.jpg',
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    // El cover se valida después de pasar permisos pero antes del UPDATE.
    expect(transactionFn).not.toHaveBeenCalled()
    expect(postUpdateMany).not.toHaveBeenCalled()
    expect(libraryItemUpdate).not.toHaveBeenCalled()
  })

  // stub F.1: el schema acepta `body: unknown` durante la migración a Lexical
  // (antes era richTextDocumentSchema con allowlist de nodos). F.2 vuelve a
  // apretarlo y este test rechaza nodos fuera del allowlist.
  it.skip('body con nodo fuera del allowlist: ValidationError de Zod — re-habilitado en F.2', async () => {
    await expect(
      updateLibraryItemAction({
        itemId: ITEM_ID,
        title: VALID_TITLE,
        body: {
          type: 'doc',
          content: [{ type: 'iframe', attrs: { src: 'https://evil.example' } }],
        },
        coverUrl: VALID_COVER,
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(libraryItemFindUnique).not.toHaveBeenCalled()
  })

  it('itemId vacío: ValidationError sin tocar Prisma', async () => {
    await expect(
      updateLibraryItemAction({
        itemId: '',
        title: VALID_TITLE,
        body: VALID_BODY,
        coverUrl: VALID_COVER,
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(libraryItemFindUnique).not.toHaveBeenCalled()
  })

  it('expectedVersion negativo: ValidationError sin tocar Prisma', async () => {
    await expect(
      updateLibraryItemAction({
        itemId: ITEM_ID,
        title: VALID_TITLE,
        body: VALID_BODY,
        coverUrl: VALID_COVER,
        expectedVersion: -1,
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(libraryItemFindUnique).not.toHaveBeenCalled()
  })
})

describe('updateLibraryItemAction — errores estructurales', () => {
  it('item inexistente: NotFoundError antes de resolver actor', async () => {
    libraryItemFindUnique.mockResolvedValue(null)

    await expect(
      updateLibraryItemAction({
        itemId: 'item-missing',
        title: VALID_TITLE,
        body: VALID_BODY,
        coverUrl: VALID_COVER,
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(NotFoundError)

    // Short-circuit: no se intenta resolver actor ni queries posteriores.
    expect(getUserFn).not.toHaveBeenCalled()
    expect(placeFindUnique).not.toHaveBeenCalled()
    expect(transactionFn).not.toHaveBeenCalled()
    expect(postUpdateMany).not.toHaveBeenCalled()
    expect(libraryItemUpdate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })
})

describe('updateLibraryItemAction — optimistic locking (CRITICAL fix)', () => {
  /**
   * Cierre del lost-write: el cliente envía `expectedVersion` y la action
   * hace `updateMany({ where: { id, version: expectedVersion } })`. Si
   * otro editor ya bumpeó `version`, `updateMany` matchea 0 filas y la
   * action tira `ConflictError` — la UI lo mapea a "Algo cambió mientras
   * editabas. Recargá la página." (ver `friendlyLibraryErrorMessage`).
   *
   * Replica del patrón de `discussions/posts/edit.ts:200-220`.
   */
  it('write concurrente: primer save con expectedVersion=5 succeed (version → 6); segundo save con expectedVersion=5 stale → ConflictError', async () => {
    mockActiveMember({ asAdmin: true })
    libraryItemFindUnique.mockResolvedValue(itemFixture({ authorUserId: USER_ID }))
    libraryItemUpdate.mockResolvedValue({ id: ITEM_ID })

    // Primer write: la versión del Post matchea (5) → updateMany matchea
    // exactamente 1 fila → success. La action retorna `version: 6`.
    postUpdateMany.mockResolvedValueOnce({ count: 1 })
    const r1 = await updateLibraryItemAction({
      itemId: ITEM_ID,
      title: 'Pan de campo v2',
      body: VALID_BODY,
      coverUrl: VALID_COVER,
      expectedVersion: 5,
    })
    expect(r1.ok).toBe(true)
    expect(r1.version).toBe(6)

    // Segundo write: el cliente todavía cree que la versión es 5 (no se
    // enteró del primer save). La DB ya tiene version=6 → updateMany
    // matchea 0 filas → la action tira ConflictError.
    postUpdateMany.mockResolvedValueOnce({ count: 0 })
    await expect(
      updateLibraryItemAction({
        itemId: ITEM_ID,
        title: 'Pan de campo v3',
        body: VALID_BODY,
        coverUrl: VALID_COVER,
        expectedVersion: 5,
      }),
    ).rejects.toBeInstanceOf(ConflictError)

    // El primer save corrió post + libraryItem; el segundo no corrió
    // libraryItem.update (la tx aborta antes en el throw).
    expect(postUpdateMany).toHaveBeenCalledTimes(2)
    expect(libraryItemUpdate).toHaveBeenCalledTimes(1)
    // El where del updateMany incluye `version: expectedVersion` — la
    // condición que enforce el lock optimista a nivel SQL.
    expect(postUpdateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: POST_ID, version: 5 },
      data: { version: 6 },
    })
    expect(postUpdateMany.mock.calls[1]?.[0]).toMatchObject({
      where: { id: POST_ID, version: 5 },
      data: { version: 6 },
    })
  })
})
