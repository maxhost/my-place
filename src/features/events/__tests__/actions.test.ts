import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'

const placeFindUnique = vi.fn()
const membershipFindFirst = vi.fn()
const ownershipFindUnique = vi.fn()
const userFindUnique = vi.fn()
const groupMembershipFindFirst = vi.fn()
const eventCreate = vi.fn()
const eventFindUnique = vi.fn()
const eventUpdate = vi.fn()
const eventRsvpUpsert = vi.fn()
const postCreate = vi.fn()
const postFindMany = vi.fn()
const txFn = vi.fn()
const getUserFn = vi.fn()
const assertPlaceOpenFn = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    place: { findUnique: (...a: unknown[]) => placeFindUnique(...a) },
    membership: { findFirst: (...a: unknown[]) => membershipFindFirst(...a) },
    placeOwnership: { findUnique: (...a: unknown[]) => ownershipFindUnique(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    groupMembership: {
      findFirst: (...a: unknown[]) => groupMembershipFindFirst(...a),
    },
    event: {
      findUnique: (...a: unknown[]) => eventFindUnique(...a),
      update: (...a: unknown[]) => eventUpdate(...a),
    },
    eventRSVP: {
      upsert: (...a: unknown[]) => eventRsvpUpsert(...a),
    },
    $transaction: (cb: (tx: unknown) => Promise<unknown>) => txFn(cb),
  },
}))

vi.mock('@/shared/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: getUserFn } }),
}))

vi.mock('@/features/hours/public.server', () => ({
  assertPlaceOpenOrThrow: (...a: unknown[]) => assertPlaceOpenFn(...a),
  findPlaceHours: vi.fn(async () => ({ kind: 'always_open' })),
}))

vi.mock('@/features/hours/public', () => ({
  assertPlaceOpenOrThrow: (...a: unknown[]) => assertPlaceOpenFn(...a),
  isAllowedTimezone: (tz: string) =>
    ['America/Argentina/Buenos_Aires', 'Europe/Madrid', 'UTC'].includes(tz),
}))

vi.mock('@/features/discussions/public.server', () => ({
  createPostFromSystemHelper: vi.fn(async () => ({ id: 'post-1', slug: 'asado' })),
  resolveActorForPlace: async ({ placeId }: { placeId: string }) => {
    const userResult = await getUserFn()
    const userId = userResult?.data?.user?.id ?? null
    if (!userId) {
      throw new Error('no auth user')
    }
    const place = await placeFindUnique({ where: { id: placeId } })
    const membership = await membershipFindFirst()
    const ownership = await ownershipFindUnique()
    const isPresetMember = await groupMembershipFindFirst()
    const user = await userFindUnique()
    return {
      actorId: userId,
      userId,
      placeId: place?.id ?? placeId,
      placeSlug: place?.slug ?? 'the-place',
      membership: membership ?? { id: 'm-1' },
      isAdmin: ownership !== null || isPresetMember !== null,
      user: user ?? { displayName: 'Max', avatarUrl: null },
    }
  },
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
}))
vi.mock('server-only', () => ({}))

vi.mock('@/shared/config/env', () => ({
  serverEnv: {
    APP_EDIT_SESSION_SECRET: 'x'.repeat(48) + 'events-actions-test-secret',
  },
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    NEXT_PUBLIC_APP_DOMAIN: 'localhost:3000',
  },
}))

import { createEventAction } from '../server/actions/create'
import { updateEventAction } from '../server/actions/update'
import { cancelEventAction } from '../server/actions/cancel'
import { rsvpEventAction } from '../server/actions/rsvp'

function mockActiveMember(opts: { asAdmin?: boolean } = {}): void {
  getUserFn.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  placeFindUnique.mockResolvedValue({ id: 'place-1', slug: 'the-place', archivedAt: null })
  membershipFindFirst.mockResolvedValue({ id: 'm-1' })
  ownershipFindUnique.mockResolvedValue(null)
  groupMembershipFindFirst.mockResolvedValue(opts.asAdmin ? { id: 'gm-mock' } : null)
  userFindUnique.mockResolvedValue({ displayName: 'Max', avatarUrl: null })
  assertPlaceOpenFn.mockResolvedValue(undefined)
}

const FUTURE_DATE = new Date(Date.now() + 60 * 60 * 1000) // +1h

beforeEach(() => {
  vi.resetAllMocks()
})

// ============================================================================
// createEventAction (4 casos)
// ============================================================================

describe('createEventAction', () => {
  it('happy path: crea Event + Post bajo tx atómica + revalida', async () => {
    mockActiveMember()
    // Simulamos la tx ejecutando el callback con un tx client mock que reusa
    // los spies de prisma.
    txFn.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        event: {
          create: (...a: unknown[]) => eventCreate(...a),
          update: (...a: unknown[]) => eventUpdate(...a),
        },
        post: {
          create: (...a: unknown[]) => postCreate(...a),
          findMany: (...a: unknown[]) => postFindMany(...a),
        },
      }
      return cb(tx)
    })
    eventCreate.mockResolvedValue({ id: 'evt-1', title: 'Asado del viernes' })
    eventUpdate.mockResolvedValue({ id: 'evt-1', postId: 'post-1' })

    const result = await createEventAction({
      placeId: 'place-1',
      title: 'Asado del viernes',
      startsAt: FUTURE_DATE,
      timezone: 'America/Argentina/Buenos_Aires',
    })

    expect(result).toEqual({ ok: true, eventId: 'evt-1', postSlug: 'asado' })
    expect(eventCreate).toHaveBeenCalled()
    expect(eventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { postId: 'post-1' } }),
    )
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/events')
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/events/evt-1')
    expect(revalidatePathFn).toHaveBeenCalledWith('/the-place/conversations/asado')
  })

  it('timezone fuera de whitelist → ValidationError sin tocar la tx', async () => {
    mockActiveMember()
    await expect(
      createEventAction({
        placeId: 'place-1',
        title: 'Asado del viernes',
        startsAt: FUTURE_DATE,
        timezone: 'Antarctica/Troll',
      }),
    ).rejects.toThrow(ValidationError)
    expect(txFn).not.toHaveBeenCalled()
  })

  it('startsAt en pasado → ValidationError', async () => {
    mockActiveMember()
    await expect(
      createEventAction({
        placeId: 'place-1',
        title: 'Asado del viernes',
        startsAt: new Date(Date.now() - 60 * 60 * 1000),
        timezone: 'America/Argentina/Buenos_Aires',
      }),
    ).rejects.toThrow(/futuro/)
  })

  it('Post falla mid-tx → la tx propaga el error y no revalida', async () => {
    mockActiveMember()
    txFn.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        event: {
          create: (...a: unknown[]) => eventCreate(...a),
          update: (...a: unknown[]) => eventUpdate(...a),
        },
        post: { create: (...a: unknown[]) => postCreate(...a), findMany: () => [] },
      }
      return cb(tx)
    })
    eventCreate.mockResolvedValue({ id: 'evt-2', title: 'X' })
    // Override del helper mock para que falle.
    const helperMod = await import('@/features/discussions/public.server')
    vi.mocked(helperMod.createPostFromSystemHelper).mockRejectedValueOnce(
      new ConflictError('slug exhausted'),
    )

    await expect(
      createEventAction({
        placeId: 'place-1',
        title: 'Asado',
        startsAt: FUTURE_DATE,
        timezone: 'America/Argentina/Buenos_Aires',
      }),
    ).rejects.toThrow(ConflictError)
    expect(revalidatePathFn).not.toHaveBeenCalled()
  })
})

// ============================================================================
// updateEventAction (4 casos)
// ============================================================================

describe('updateEventAction', () => {
  function setupExistingEvent(authorUserId: string | null = 'user-1'): void {
    eventFindUnique.mockResolvedValue({
      id: 'evt-1',
      placeId: 'place-1',
      authorUserId,
      postId: 'post-1',
      cancelledAt: null,
    })
  }

  it('author actualiza su evento OK', async () => {
    mockActiveMember()
    setupExistingEvent('user-1')
    eventUpdate.mockResolvedValue({ id: 'evt-1' })
    const result = await updateEventAction({
      eventId: 'evt-1',
      title: 'Asado actualizado',
      startsAt: FUTURE_DATE,
      timezone: 'America/Argentina/Buenos_Aires',
    })
    expect(result).toEqual({ ok: true })
    expect(eventUpdate).toHaveBeenCalled()
  })

  it('no-author no-admin → AuthorizationError', async () => {
    mockActiveMember()
    setupExistingEvent('other-user')
    await expect(
      updateEventAction({
        eventId: 'evt-1',
        title: 'Hijack',
        startsAt: FUTURE_DATE,
        timezone: 'America/Argentina/Buenos_Aires',
      }),
    ).rejects.toThrow(AuthorizationError)
    expect(eventUpdate).not.toHaveBeenCalled()
  })

  it('admin puede actualizar evento ajeno', async () => {
    mockActiveMember({ asAdmin: true })
    setupExistingEvent('other-user')
    eventUpdate.mockResolvedValue({ id: 'evt-1' })
    const result = await updateEventAction({
      eventId: 'evt-1',
      title: 'Admin moderó',
      startsAt: FUTURE_DATE,
      timezone: 'America/Argentina/Buenos_Aires',
    })
    expect(result).toEqual({ ok: true })
  })

  it('NO actualiza el Post asociado (sólo Event)', async () => {
    mockActiveMember()
    setupExistingEvent('user-1')
    eventUpdate.mockResolvedValue({ id: 'evt-1' })
    await updateEventAction({
      eventId: 'evt-1',
      title: 'Cambié el título',
      startsAt: FUTURE_DATE,
      timezone: 'America/Argentina/Buenos_Aires',
    })
    // Sólo se llamó eventUpdate, no postCreate ni nada relacionado al Post.
    expect(eventUpdate).toHaveBeenCalledTimes(1)
    expect(eventUpdate.mock.calls[0]?.[0]).not.toHaveProperty('include.post')
  })
})

// ============================================================================
// cancelEventAction (2 casos)
// ============================================================================

describe('cancelEventAction', () => {
  it('setea cancelledAt y revalida; NO toca Post ni RSVPs', async () => {
    mockActiveMember()
    eventFindUnique.mockResolvedValue({
      id: 'evt-1',
      placeId: 'place-1',
      authorUserId: 'user-1',
      cancelledAt: null,
    })
    eventUpdate.mockResolvedValue({ id: 'evt-1' })
    const result = await cancelEventAction({ eventId: 'evt-1' })
    expect(result).toEqual({ ok: true })
    expect(eventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'evt-1' },
        data: expect.objectContaining({ cancelledAt: expect.any(Date) }),
      }),
    )
  })

  it('no-author no-admin → AuthorizationError', async () => {
    mockActiveMember()
    eventFindUnique.mockResolvedValue({
      id: 'evt-1',
      placeId: 'place-1',
      authorUserId: 'other-user',
      cancelledAt: null,
    })
    await expect(cancelEventAction({ eventId: 'evt-1' })).rejects.toThrow(AuthorizationError)
    expect(eventUpdate).not.toHaveBeenCalled()
  })
})

// ============================================================================
// rsvpEventAction (5 casos)
// ============================================================================

describe('rsvpEventAction', () => {
  function setupActiveEvent(): void {
    eventFindUnique.mockResolvedValue({
      id: 'evt-1',
      placeId: 'place-1',
      cancelledAt: null,
    })
  }

  it('crea RSVP nueva con state GOING (sin note)', async () => {
    mockActiveMember()
    setupActiveEvent()
    eventRsvpUpsert.mockResolvedValue({})
    await rsvpEventAction({ eventId: 'evt-1', state: 'GOING' })
    expect(eventRsvpUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ state: 'GOING', note: null }),
        update: expect.objectContaining({ state: 'GOING', note: null }),
      }),
    )
  })

  it('upsert con state GOING_CONDITIONAL preserva note trimmeado', async () => {
    mockActiveMember()
    setupActiveEvent()
    eventRsvpUpsert.mockResolvedValue({})
    await rsvpEventAction({
      eventId: 'evt-1',
      state: 'GOING_CONDITIONAL',
      note: '  si llego del trabajo  ',
    })
    expect(eventRsvpUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          state: 'GOING_CONDITIONAL',
          note: 'si llego del trabajo',
        }),
      }),
    )
  })

  it('note en state GOING → ValidationError', async () => {
    mockActiveMember()
    setupActiveEvent()
    await expect(
      rsvpEventAction({ eventId: 'evt-1', state: 'GOING', note: 'random' }),
    ).rejects.toThrow(/sólo aplica/)
    expect(eventRsvpUpsert).not.toHaveBeenCalled()
  })

  it('evento cancelado → ConflictError', async () => {
    mockActiveMember()
    eventFindUnique.mockResolvedValue({
      id: 'evt-1',
      placeId: 'place-1',
      cancelledAt: new Date(),
    })
    await expect(rsvpEventAction({ eventId: 'evt-1', state: 'GOING' })).rejects.toThrow(
      ConflictError,
    )
    expect(eventRsvpUpsert).not.toHaveBeenCalled()
  })

  it('evento inexistente → NotFoundError', async () => {
    mockActiveMember()
    eventFindUnique.mockResolvedValue(null)
    await expect(rsvpEventAction({ eventId: 'evt-x', state: 'GOING' })).rejects.toThrow(
      NotFoundError,
    )
  })
})
