import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Test para `inviteContributorAction` (R.7.4 — M3 batch HIGH).
 *
 * Replica el patrón pilot de `archive-category.test.ts`:
 *  1. Mocks granulares de Prisma por modelo (libraryCategory + identidad +
 *     contributor + membership target).
 *  2. Mock de Supabase auth (`createSupabaseServer`) y de `next/cache`.
 *  3. Helper local `mockActiveMember(role, opts)` inline.
 *  4. `vi.clearAllMocks()` en `beforeEach`.
 *  5. Imports de la action al final, después de los `vi.mock` (hoisting).
 *
 * Notar que el action usa DOS llamadas a `prisma.membership`:
 *  - `findFirst` lo consume `resolveActorForPlace` para el actor.
 *  - `findUnique` (compound key) verifica que el invitado es miembro activo.
 */

// ---------------------------------------------------------------
// Prisma + auxiliares mockeados
// ---------------------------------------------------------------

const libraryCategoryFindUnique = vi.fn()
const libraryCategoryContributorCreate = vi.fn()
const placeFindUnique = vi.fn()
const membershipFindFirst = vi.fn()
const membershipFindUnique = vi.fn()
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
    },
    libraryCategoryContributor: {
      create: (...a: unknown[]) => libraryCategoryContributorCreate(...a),
    },
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
    membership: {
      findFirst: (...a: unknown[]) => membershipFindFirst(...a),
      findUnique: (...a: unknown[]) => membershipFindUnique(...a),
    },
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

import { inviteContributorAction } from '@/features/library/contributors/server/actions/invite-contributor'
import { PERMISSIONS_ALL } from '@/features/groups/public'

// ---------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'the-place'
const ACTOR_USER_ID = 'user-1'
const INVITED_USER_ID = 'user-2'
const CATEGORY_ID = 'cat-1'
const CATEGORY_SLUG = 'recetas'

type ActorOpts = {
  /** Si true, mockea grupos para que `isAdmin`/`hasPermission` retornen true. */
  asAdmin?: boolean
  /** Si true, ownership row presente — gatilla `isAdmin` aunque no sea admin. */
  isOwner?: boolean
}

function mockActiveMember(opts: ActorOpts = {}): void {
  getUserFn.mockResolvedValue({ data: { user: { id: ACTOR_USER_ID } } })
  placeFindUnique.mockResolvedValue({
    id: PLACE_ID,
    slug: PLACE_SLUG,
    name: 'The Place',
    archivedAt: null,
    themeConfig: null,
    openingHours: null,
  })
  membershipFindFirst.mockResolvedValue({ id: 'm-1' })
  ownershipFindUnique.mockResolvedValue(opts.isOwner ? { userId: ACTOR_USER_ID } : null)
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

function mockInvitedMembershipActive(): void {
  membershipFindUnique.mockResolvedValue({ leftAt: null })
}

function makeP2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe('inviteContributorAction — happy paths', () => {
  it('admin: crea contributor row, revalida los 3 paths y retorna alreadyInvited=false', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
    })
    mockInvitedMembershipActive()
    libraryCategoryContributorCreate.mockResolvedValue({
      categoryId: CATEGORY_ID,
      userId: INVITED_USER_ID,
    })

    const result = await inviteContributorAction({
      categoryId: CATEGORY_ID,
      userId: INVITED_USER_ID,
    })

    expect(result).toEqual({ ok: true, alreadyInvited: false })
    expect(libraryCategoryContributorCreate).toHaveBeenCalledTimes(1)
    expect(libraryCategoryContributorCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          categoryId: CATEGORY_ID,
          userId: INVITED_USER_ID,
          invitedByUserId: ACTOR_USER_ID,
        }),
      }),
    )
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library/${CATEGORY_SLUG}`)
  })

  it('owner sin rol ADMIN: ownership row alcanza para invitar', async () => {
    mockActiveMember({ isOwner: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
    })
    mockInvitedMembershipActive()
    libraryCategoryContributorCreate.mockResolvedValue({
      categoryId: CATEGORY_ID,
      userId: INVITED_USER_ID,
    })

    const result = await inviteContributorAction({
      categoryId: CATEGORY_ID,
      userId: INVITED_USER_ID,
    })

    expect(result).toEqual({ ok: true, alreadyInvited: false })
    expect(ownershipFindUnique).toHaveBeenCalled()
    expect(libraryCategoryContributorCreate).toHaveBeenCalledTimes(1)
  })
})

describe('inviteContributorAction — idempotencia', () => {
  it('P2002 (ya es contributor): retorna alreadyInvited=true y revalida igual', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
    })
    mockInvitedMembershipActive()
    libraryCategoryContributorCreate.mockRejectedValue(makeP2002())

    const result = await inviteContributorAction({
      categoryId: CATEGORY_ID,
      userId: INVITED_USER_ID,
    })

    expect(result).toEqual({ ok: true, alreadyInvited: true })
    expect(libraryCategoryContributorCreate).toHaveBeenCalledTimes(1)
    // Idempotente: igual revalida (UI puede haber quedado stale en otra tab).
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/library`)
    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/library/${CATEGORY_SLUG}`)
  })
})

describe('inviteContributorAction — autorización', () => {
  it('member común (no admin, no owner): AuthorizationError sin tocar create', async () => {
    mockActiveMember()
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
    })

    await expect(
      inviteContributorAction({ categoryId: CATEGORY_ID, userId: INVITED_USER_ID }),
    ).rejects.toBeInstanceOf(AuthorizationError)

    expect(membershipFindUnique).not.toHaveBeenCalled()
    expect(libraryCategoryContributorCreate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })
})

describe('inviteContributorAction — errores estructurales', () => {
  it('categoría inexistente: NotFoundError antes de resolver actor', async () => {
    libraryCategoryFindUnique.mockResolvedValue(null)

    await expect(
      inviteContributorAction({ categoryId: 'cat-missing', userId: INVITED_USER_ID }),
    ).rejects.toBeInstanceOf(NotFoundError)

    expect(getUserFn).not.toHaveBeenCalled()
    expect(membershipFindUnique).not.toHaveBeenCalled()
    expect(libraryCategoryContributorCreate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })

  it('invited userId no es miembro del place: ValidationError sin tocar create', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
    })
    membershipFindUnique.mockResolvedValue(null)

    await expect(
      inviteContributorAction({ categoryId: CATEGORY_ID, userId: 'user-outsider' }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(libraryCategoryContributorCreate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })

  it('invited userId fue miembro pero ya hizo leftAt: ValidationError', async () => {
    mockActiveMember({ asAdmin: true })
    libraryCategoryFindUnique.mockResolvedValue({
      id: CATEGORY_ID,
      placeId: PLACE_ID,
      slug: CATEGORY_SLUG,
    })
    membershipFindUnique.mockResolvedValue({ leftAt: new Date('2026-04-01T10:00:00Z') })

    await expect(
      inviteContributorAction({ categoryId: CATEGORY_ID, userId: INVITED_USER_ID }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(libraryCategoryContributorCreate).not.toHaveBeenCalled()
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })

  it('input mal formado (sin userId): ValidationError sin tocar Prisma', async () => {
    await expect(inviteContributorAction({ categoryId: CATEGORY_ID })).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(libraryCategoryFindUnique).not.toHaveBeenCalled()
  })

  it('input con categoryId vacío: ValidationError sin tocar Prisma', async () => {
    await expect(
      inviteContributorAction({ categoryId: '', userId: INVITED_USER_ID }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(libraryCategoryFindUnique).not.toHaveBeenCalled()
  })
})
