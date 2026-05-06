import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Tests de `expelMemberAction` (G.4 — PermissionGroups).
 *
 * **Owner-only HARDCODED** — chequeo via `findPlaceOwnership(actor)`.
 * NO hay permiso atómico delegable (decisión #8 ADR PermissionGroups).
 *
 * Cobertura:
 *  - Happy path: setea leftAt + metadata + email + revalida.
 *  - Discriminated union: cannot_expel_owner, cannot_expel_self,
 *    target_user_not_member.
 *  - Gates: ValidationError, AuthorizationError (actor no es owner —
 *    NO hay fallback a permiso, throw directo), NotFoundError.
 *  - Try/catch del email: failure no bloquea el commit.
 */

const requireAuthUserIdFn = vi.fn()
const findPlaceOwnershipFn = vi.fn()
const loadPlaceByIdFn = vi.fn()
const membershipFindFirst = vi.fn()
const membershipUpdate = vi.fn()
const sendExpelEmailFn = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    membership: {
      findFirst: (...a: unknown[]) => membershipFindFirst(...a),
      update: (...a: unknown[]) => membershipUpdate(...a),
    },
  },
}))

vi.mock('@/shared/lib/auth-user', () => ({
  requireAuthUserId: (...a: unknown[]) => requireAuthUserIdFn(...a),
}))

vi.mock('@/shared/lib/identity-cache', () => ({
  findPlaceOwnership: (...a: unknown[]) => findPlaceOwnershipFn(...a),
  // Plan #2.3: el action ahora importa transitivamente
  // `members/public.server.ts` (para `revalidateMemberPermissions`), que
  // re-exporta queries que usan `findActiveMembership` + `findIsPlaceAdmin`.
  // Aunque este test no las invoca, los mocks deben proveer la superficie
  // completa porque vi.mock reemplaza el módulo entero.
  findActiveMembership: vi.fn(),
  findIsPlaceAdmin: vi.fn(),
}))

vi.mock('@/shared/lib/place-loader', () => ({
  loadPlaceById: (...a: unknown[]) => loadPlaceByIdFn(...a),
}))

vi.mock('@/features/members/moderation/server/mailer/expel-email', () => ({
  sendExpelEmail: (...a: unknown[]) => sendExpelEmailFn(...a),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
  // Plan #2.3: el action invalida findMemberPermissions del expulsado
  // via revalidateTag.
  unstable_cache: <T extends (...args: never[]) => Promise<unknown>>(fn: T): T => fn,
  revalidateTag: vi.fn(),
}))

vi.mock('server-only', () => ({}))

// Plan #2.3: importar `revalidateMemberPermissions` desde `public.server.ts`
// del slice `members` arrastra UI components que importan actions legacy con
// `clientEnv` eager. Mockear env evita el parse Zod en tests.
vi.mock('@/shared/config/env', () => ({
  clientEnv: {
    NEXT_PUBLIC_APP_URL: 'http://lvh.me:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'lvh.me:3000',
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  },
  serverEnv: {
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    NODE_ENV: 'test',
  },
}))

import { expelMemberAction } from '@/features/members/moderation/server/actions/expel-member'

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'palermo'
const PLACE_NAME = 'Palermo'
const ACTOR_ID = 'user-owner'
const TARGET_USER_ID = 'user-target'
const TARGET_EMAIL = 'target@example.com'
const TARGET_MEMBERSHIP_ID = 'mem-target'

const PLACE_FIXTURE = {
  id: PLACE_ID,
  slug: PLACE_SLUG,
  name: PLACE_NAME,
  archivedAt: null,
}

const VALID_INPUT = {
  placeId: PLACE_ID,
  memberUserId: TARGET_USER_ID,
  reason: 'Conducta tóxica reiterada.',
  contactEmail: 'owner@example.com',
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAuthUserIdFn.mockResolvedValue(ACTOR_ID)
  loadPlaceByIdFn.mockResolvedValue(PLACE_FIXTURE)
  // Por default: actor ES owner, target NO es owner, ES miembro activo.
  findPlaceOwnershipFn.mockImplementation(async (uid: string) => uid === ACTOR_ID)
  membershipFindFirst.mockResolvedValue({
    id: TARGET_MEMBERSHIP_ID,
    user: { email: TARGET_EMAIL },
  })
  membershipUpdate.mockResolvedValue({ id: TARGET_MEMBERSHIP_ID })
  sendExpelEmailFn.mockResolvedValue({ id: 'msg-1', provider: 'fake' })
})

describe('expelMemberAction — happy path', () => {
  it('expulsa al miembro y retorna { ok: true }', async () => {
    const result = await expelMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: true })
    expect(membershipUpdate).toHaveBeenCalledWith({
      where: { id: TARGET_MEMBERSHIP_ID },
      data: {
        leftAt: expect.any(Date),
        expelledByUserId: ACTOR_ID,
        expelReason: VALID_INPUT.reason,
        expelContactEmail: VALID_INPUT.contactEmail,
      },
    })
  })

  it('envía email con motivo y contactEmail', async () => {
    await expelMemberAction(VALID_INPUT)

    expect(sendExpelEmailFn).toHaveBeenCalledWith({
      to: TARGET_EMAIL,
      placeName: PLACE_NAME,
      reason: VALID_INPUT.reason,
      contactEmail: VALID_INPUT.contactEmail,
    })
  })

  it('revalida directorio + detalle + inbox', async () => {
    await expelMemberAction(VALID_INPUT)

    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/members`)
    expect(revalidatePathFn).toHaveBeenCalledWith(
      `/${PLACE_SLUG}/settings/members/${TARGET_USER_ID}`,
    )
    expect(revalidatePathFn).toHaveBeenCalledWith('/inbox')
  })
})

describe('expelMemberAction — owner-only', () => {
  it('actor NO es owner → AuthorizationError (sin permiso atómico delegable)', async () => {
    findPlaceOwnershipFn.mockImplementation(async () => false)

    await expect(expelMemberAction(VALID_INPUT)).rejects.toBeInstanceOf(AuthorizationError)
    expect(membershipUpdate).not.toHaveBeenCalled()
    expect(sendExpelEmailFn).not.toHaveBeenCalled()
  })
})

describe('expelMemberAction — discriminated union errors', () => {
  it('actor === target → cannot_expel_self (sin tocar DB)', async () => {
    requireAuthUserIdFn.mockResolvedValue(TARGET_USER_ID)
    // El target ahora es el actor, ambos owners (porque actor es owner).
    findPlaceOwnershipFn.mockImplementation(async () => true)

    const result = await expelMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'cannot_expel_self' })
    expect(membershipUpdate).not.toHaveBeenCalled()
  })

  it('target es otro owner → cannot_expel_owner', async () => {
    findPlaceOwnershipFn.mockImplementation(async () => true) // actor owner + target owner

    const result = await expelMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'cannot_expel_owner' })
    expect(membershipUpdate).not.toHaveBeenCalled()
    expect(sendExpelEmailFn).not.toHaveBeenCalled()
  })

  it('target no es miembro activo → target_user_not_member', async () => {
    membershipFindFirst.mockResolvedValue(null)

    const result = await expelMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: false, error: 'target_user_not_member' })
    expect(membershipUpdate).not.toHaveBeenCalled()
    expect(sendExpelEmailFn).not.toHaveBeenCalled()
  })
})

describe('expelMemberAction — gates', () => {
  it('input inválido (reason vacío) → ValidationError', async () => {
    await expect(expelMemberAction({ ...VALID_INPUT, reason: '' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('input inválido (contactEmail no es email) → ValidationError', async () => {
    await expect(
      expelMemberAction({ ...VALID_INPUT, contactEmail: 'nope' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('reason demasiado largo → ValidationError', async () => {
    await expect(
      expelMemberAction({ ...VALID_INPUT, reason: 'x'.repeat(501) }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('place inexistente → NotFoundError', async () => {
    loadPlaceByIdFn.mockResolvedValue(null)
    await expect(expelMemberAction(VALID_INPUT)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('place archivado → NotFoundError', async () => {
    loadPlaceByIdFn.mockResolvedValue({ ...PLACE_FIXTURE, archivedAt: new Date() })
    await expect(expelMemberAction(VALID_INPUT)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('búsqueda de target filtra por leftAt:null (sólo activos)', async () => {
    await expelMemberAction(VALID_INPUT)

    expect(membershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: TARGET_USER_ID, placeId: PLACE_ID, leftAt: null },
      }),
    )
  })
})

describe('expelMemberAction — email failure resilience', () => {
  it('si el mailer tira, la action commitea ok:true igualmente', async () => {
    sendExpelEmailFn.mockRejectedValueOnce(new Error('resend down'))

    const result = await expelMemberAction(VALID_INPUT)

    expect(result).toEqual({ ok: true })
    expect(membershipUpdate).toHaveBeenCalled()
  })

  it('falla del mailer NO impide la revalidación', async () => {
    sendExpelEmailFn.mockRejectedValueOnce(new Error('resend down'))

    await expelMemberAction(VALID_INPUT)

    expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/members`)
  })
})
