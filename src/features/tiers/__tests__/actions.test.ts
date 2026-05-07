import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'

/**
 * Tests de las 3 server actions del slice `tiers` (T.3 + refactor 2026-05-02).
 *
 * Modelo actualizado (decisión #11 ADR):
 *  - **Sin dedup global de nombre**: N tiers con mismo name case-insensitive
 *    pueden coexistir en el mismo place (siempre que máx 1 esté PUBLISHED).
 *  - **Invariante DB**: partial unique
 *    `Tier_placeId_lowerName_published_unique` ON (placeId, LOWER(name))
 *    WHERE visibility = 'PUBLISHED'.
 *  - `createTierAction`: nunca rechaza por nombre — los nuevos arrancan
 *    HIDDEN, no pueden violar el index.
 *  - `updateTierAction`: chequea colisión sólo si el tier está PUBLISHED y
 *    el name cambia. Catch P2002 como fallback.
 *  - `setTierVisibilityAction`: chequea colisión al pasar a PUBLISHED.
 *    Catch P2002 como fallback.
 *  - Errores esperados → discriminated union return.
 *  - Errores inesperados (auth, notfound, validation) → throw.
 */

const requireAuthUserIdFn = vi.fn()
const findPlaceOwnershipFn = vi.fn()
const loadPlaceBySlugFn = vi.fn()
const loadPlaceByIdFn = vi.fn()
const tierFindUnique = vi.fn()
const tierFindFirst = vi.fn()
const tierCreate = vi.fn()
const tierUpdate = vi.fn()
const revalidatePathFn = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    tier: {
      findUnique: (...a: unknown[]) => tierFindUnique(...a),
      findFirst: (...a: unknown[]) => tierFindFirst(...a),
      create: (...a: unknown[]) => tierCreate(...a),
      update: (...a: unknown[]) => tierUpdate(...a),
    },
  },
}))

vi.mock('@/shared/lib/auth-user', () => ({
  requireAuthUserId: (...a: unknown[]) => requireAuthUserIdFn(...a),
}))

vi.mock('@/shared/lib/identity-cache', () => ({
  findPlaceOwnership: (...a: unknown[]) => findPlaceOwnershipFn(...a),
}))

vi.mock('@/shared/lib/place-loader', () => ({
  loadPlaceBySlug: (...a: unknown[]) => loadPlaceBySlugFn(...a),
  loadPlaceById: (...a: unknown[]) => loadPlaceByIdFn(...a),
}))

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
  revalidatePath: (...a: unknown[]) => revalidatePathFn(...a),
  revalidateTag: vi.fn(),
}))

vi.mock('server-only', () => ({}))

import { createTierAction } from '../server/actions/create-tier'
import { setTierVisibilityAction } from '../server/actions/set-tier-visibility'
import { updateTierAction } from '../server/actions/update-tier'

const PLACE_ID = 'place-1'
const PLACE_SLUG = 'palermo'
const ACTOR_ID = 'user-1'
const TIER_ID = 'tier-1'

const PLACE_FIXTURE = {
  id: PLACE_ID,
  slug: PLACE_SLUG,
  name: 'Palermo',
  archivedAt: null,
}

const VALID_CREATE_INPUT = {
  placeSlug: PLACE_SLUG,
  name: 'Básico',
  description: 'Acceso básico al place.',
  priceCents: 199,
  currency: 'USD' as const,
  duration: 'ONE_MONTH' as const,
}

const VALID_UPDATE_INPUT = {
  tierId: TIER_ID,
  name: 'Básico',
  description: 'Nueva descripción.',
  priceCents: 299,
  currency: 'USD' as const,
  duration: 'ONE_MONTH' as const,
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`placeId`, `name`)',
    { code: 'P2002', clientVersion: 'test' },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAuthUserIdFn.mockResolvedValue(ACTOR_ID)
  findPlaceOwnershipFn.mockResolvedValue(true)
  loadPlaceBySlugFn.mockResolvedValue(PLACE_FIXTURE)
  loadPlaceByIdFn.mockResolvedValue(PLACE_FIXTURE)
})

// ===============================================================
// createTierAction — sin dedup, siempre arranca HIDDEN
// ===============================================================

describe('createTierAction', () => {
  beforeEach(() => {
    tierCreate.mockResolvedValue({ id: TIER_ID })
  })

  describe('happy path', () => {
    it('crea tier de pago y retorna { ok, tierId }', async () => {
      const result = await createTierAction(VALID_CREATE_INPUT)

      expect(result).toEqual({ ok: true, tierId: TIER_ID })
      expect(tierCreate).toHaveBeenCalledTimes(1)
      const call = tierCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
      expect(call.data.placeId).toBe(PLACE_ID)
      expect(call.data.name).toBe('Básico')
      expect(call.data.priceCents).toBe(199)
      // visibility no se pasa — el schema default `HIDDEN` aplica.
      expect(call.data.visibility).toBeUndefined()
      expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/tiers`)
    })

    it('crea tier gratis (priceCents = 0)', async () => {
      const result = await createTierAction({ ...VALID_CREATE_INPUT, priceCents: 0 })

      expect(result.ok).toBe(true)
      const call = tierCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
      expect(call.data.priceCents).toBe(0)
    })

    it('trim del name antes de persistir', async () => {
      await createTierAction({ ...VALID_CREATE_INPUT, name: '  Premium  ' })

      const call = tierCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
      expect(call.data.name).toBe('Premium')
    })

    it('description vacía o null se persiste como null', async () => {
      await createTierAction({ ...VALID_CREATE_INPUT, description: '   ' })

      const call = tierCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
      expect(call.data.description).toBeNull()
    })

    it('NO chequea colisión de nombre — N tiers con mismo name pueden coexistir HIDDEN', async () => {
      // El partial unique sólo aplica a PUBLISHED. createTier siempre arranca
      // HIDDEN, así que NO consulta la DB para verificar duplicados.
      await createTierAction(VALID_CREATE_INPUT)

      expect(tierFindFirst).not.toHaveBeenCalled()
    })
  })

  describe('validación Zod', () => {
    it('rechaza priceCents negativo', async () => {
      await expect(createTierAction({ ...VALID_CREATE_INPUT, priceCents: -1 })).rejects.toThrow(
        ValidationError,
      )
      expect(tierCreate).not.toHaveBeenCalled()
    })

    it('rechaza priceCents > cap (999_999)', async () => {
      await expect(
        createTierAction({ ...VALID_CREATE_INPUT, priceCents: 1_000_000 }),
      ).rejects.toThrow(ValidationError)
    })

    it('rechaza name vacío', async () => {
      await expect(createTierAction({ ...VALID_CREATE_INPUT, name: '' })).rejects.toThrow(
        ValidationError,
      )
    })

    it('rechaza name > 60 chars', async () => {
      await expect(
        createTierAction({ ...VALID_CREATE_INPUT, name: 'a'.repeat(61) }),
      ).rejects.toThrow(ValidationError)
    })

    it('rechaza currency fuera de la allowlist v1', async () => {
      await expect(
        createTierAction({ ...VALID_CREATE_INPUT, currency: 'ARS' as 'USD' }),
      ).rejects.toThrow(ValidationError)
    })

    it('rechaza duration fuera del enum', async () => {
      await expect(
        createTierAction({ ...VALID_CREATE_INPUT, duration: 'TWO_WEEKS' as 'ONE_MONTH' }),
      ).rejects.toThrow(ValidationError)
    })
  })

  describe('gates', () => {
    it('place inexistente → NotFoundError', async () => {
      loadPlaceBySlugFn.mockResolvedValue(null)
      await expect(createTierAction(VALID_CREATE_INPUT)).rejects.toThrow(NotFoundError)
      expect(tierCreate).not.toHaveBeenCalled()
    })

    it('place archivado → NotFoundError', async () => {
      loadPlaceBySlugFn.mockResolvedValue({ ...PLACE_FIXTURE, archivedAt: new Date() })
      await expect(createTierAction(VALID_CREATE_INPUT)).rejects.toThrow(NotFoundError)
    })

    it('actor sin ownership → AuthorizationError (admin no califica)', async () => {
      findPlaceOwnershipFn.mockResolvedValue(false)
      await expect(createTierAction(VALID_CREATE_INPUT)).rejects.toThrow(AuthorizationError)
      expect(tierCreate).not.toHaveBeenCalled()
    })
  })
})

// ===============================================================
// updateTierAction — chequea colisión sólo si está PUBLISHED + name cambia
// ===============================================================

describe('updateTierAction', () => {
  beforeEach(() => {
    tierFindUnique.mockResolvedValue({
      id: TIER_ID,
      placeId: PLACE_ID,
      name: 'Básico',
      visibility: 'HIDDEN' as const,
    })
    tierFindFirst.mockResolvedValue(null)
    tierUpdate.mockResolvedValue({ id: TIER_ID })
  })

  describe('happy path', () => {
    it('edita tier HIDDEN sin chequear colisión (no aplica el unique)', async () => {
      const result = await updateTierAction(VALID_UPDATE_INPUT)

      expect(result).toEqual({ ok: true })
      expect(tierFindFirst).not.toHaveBeenCalled() // no pre-check para HIDDEN
      expect(tierUpdate).toHaveBeenCalledTimes(1)
      expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/tiers`)
    })

    it('edita tier PUBLISHED sin cambiar name — no chequea colisión', async () => {
      tierFindUnique.mockResolvedValue({
        id: TIER_ID,
        placeId: PLACE_ID,
        name: 'Básico',
        visibility: 'PUBLISHED' as const,
      })

      const result = await updateTierAction(VALID_UPDATE_INPUT) // mismo name "Básico"

      expect(result).toEqual({ ok: true })
      expect(tierFindFirst).not.toHaveBeenCalled() // name no cambió → no check
      expect(tierUpdate).toHaveBeenCalledTimes(1)
    })

    it('edita tier PUBLISHED cambiando name a uno libre — pre-check pasa', async () => {
      tierFindUnique.mockResolvedValue({
        id: TIER_ID,
        placeId: PLACE_ID,
        name: 'Básico',
        visibility: 'PUBLISHED' as const,
      })
      tierFindFirst.mockResolvedValue(null) // no collision

      const result = await updateTierAction({ ...VALID_UPDATE_INPUT, name: 'Premium' })

      expect(result).toEqual({ ok: true })
      expect(tierFindFirst).toHaveBeenCalledTimes(1)
      const call = tierFindFirst.mock.calls[0]?.[0] as { where: Record<string, unknown> }
      expect(call.where).toMatchObject({
        placeId: PLACE_ID,
        visibility: 'PUBLISHED',
        name: { equals: 'Premium', mode: 'insensitive' },
        NOT: { id: TIER_ID },
      })
    })
  })

  describe('colisión de nombre PUBLISHED', () => {
    it('PUBLISHED + new name colisiona con OTRO PUBLISHED → return name_already_published', async () => {
      tierFindUnique.mockResolvedValue({
        id: TIER_ID,
        placeId: PLACE_ID,
        name: 'Básico',
        visibility: 'PUBLISHED' as const,
      })
      tierFindFirst.mockResolvedValue({ id: 'other-tier' })

      const result = await updateTierAction({ ...VALID_UPDATE_INPUT, name: 'Premium' })

      expect(result).toEqual({ ok: false, error: 'name_already_published' })
      expect(tierUpdate).not.toHaveBeenCalled()
      expect(revalidatePathFn).not.toHaveBeenCalled()
    })

    it('catch P2002 como fallback (race condition)', async () => {
      tierFindUnique.mockResolvedValue({
        id: TIER_ID,
        placeId: PLACE_ID,
        name: 'Básico',
        visibility: 'PUBLISHED' as const,
      })
      tierFindFirst.mockResolvedValue(null) // pre-check pasa
      tierUpdate.mockRejectedValue(p2002()) // pero el UPDATE pierde la race

      const result = await updateTierAction({ ...VALID_UPDATE_INPUT, name: 'Premium' })

      expect(result).toEqual({ ok: false, error: 'name_already_published' })
    })
  })

  describe('gates', () => {
    it('tier inexistente → NotFoundError', async () => {
      tierFindUnique.mockResolvedValue(null)
      await expect(updateTierAction(VALID_UPDATE_INPUT)).rejects.toThrow(NotFoundError)
    })

    it('place archivado → NotFoundError', async () => {
      loadPlaceByIdFn.mockResolvedValue({ ...PLACE_FIXTURE, archivedAt: new Date() })
      await expect(updateTierAction(VALID_UPDATE_INPUT)).rejects.toThrow(NotFoundError)
    })

    it('actor sin ownership → AuthorizationError', async () => {
      findPlaceOwnershipFn.mockResolvedValue(false)
      await expect(updateTierAction(VALID_UPDATE_INPUT)).rejects.toThrow(AuthorizationError)
      expect(tierUpdate).not.toHaveBeenCalled()
    })
  })
})

// ===============================================================
// setTierVisibilityAction — pre-check al pasar a PUBLISHED
// ===============================================================

describe('setTierVisibilityAction', () => {
  beforeEach(() => {
    tierFindUnique.mockResolvedValue({
      id: TIER_ID,
      placeId: PLACE_ID,
      name: 'Básico',
      visibility: 'HIDDEN' as const,
    })
    tierFindFirst.mockResolvedValue(null)
    tierUpdate.mockResolvedValue({ id: TIER_ID })
  })

  describe('happy path', () => {
    it('publica tier oculto (no hay colisión) y retorna changed=true', async () => {
      const result = await setTierVisibilityAction({
        tierId: TIER_ID,
        visibility: 'PUBLISHED',
      })

      expect(result).toEqual({ ok: true, visibility: 'PUBLISHED', changed: true })
      expect(tierFindFirst).toHaveBeenCalledTimes(1) // pre-check porque target=PUBLISHED
      expect(tierUpdate).toHaveBeenCalledTimes(1)
      expect(revalidatePathFn).toHaveBeenCalledWith(`/${PLACE_SLUG}/settings/tiers`)
    })

    it('oculta tier publicado — sin pre-check (HIDDEN no colisiona)', async () => {
      tierFindUnique.mockResolvedValue({
        id: TIER_ID,
        placeId: PLACE_ID,
        name: 'Básico',
        visibility: 'PUBLISHED' as const,
      })

      const result = await setTierVisibilityAction({
        tierId: TIER_ID,
        visibility: 'HIDDEN',
      })

      expect(result.ok).toBe(true)
      expect(tierFindFirst).not.toHaveBeenCalled() // PUBLISHED → HIDDEN nunca colisiona
    })
  })

  describe('idempotencia', () => {
    it('si ya está en la visibility solicitada → changed=false, sin update ni revalidate', async () => {
      const result = await setTierVisibilityAction({
        tierId: TIER_ID,
        visibility: 'HIDDEN', // ya HIDDEN
      })

      expect(result).toEqual({ ok: true, visibility: 'HIDDEN', changed: false })
      expect(tierUpdate).not.toHaveBeenCalled()
      expect(revalidatePathFn).not.toHaveBeenCalled()
    })
  })

  describe('colisión al publicar', () => {
    it('publicar cuando otro tier PUBLISHED tiene mismo name → return name_already_published', async () => {
      tierFindFirst.mockResolvedValue({ id: 'other-tier' })

      const result = await setTierVisibilityAction({
        tierId: TIER_ID,
        visibility: 'PUBLISHED',
      })

      expect(result).toEqual({ ok: false, error: 'name_already_published' })
      expect(tierUpdate).not.toHaveBeenCalled()
    })

    it('catch P2002 como fallback (race condition)', async () => {
      tierFindFirst.mockResolvedValue(null) // pre-check pasa
      tierUpdate.mockRejectedValue(p2002()) // race

      const result = await setTierVisibilityAction({
        tierId: TIER_ID,
        visibility: 'PUBLISHED',
      })

      expect(result).toEqual({ ok: false, error: 'name_already_published' })
    })

    it('busca con mode=insensitive y excluye el propio tierId', async () => {
      tierFindUnique.mockResolvedValue({
        id: TIER_ID,
        placeId: PLACE_ID,
        name: 'BÁSICO',
        visibility: 'HIDDEN' as const,
      })

      await setTierVisibilityAction({ tierId: TIER_ID, visibility: 'PUBLISHED' })

      const call = tierFindFirst.mock.calls[0]?.[0] as { where: Record<string, unknown> }
      expect(call.where).toMatchObject({
        placeId: PLACE_ID,
        visibility: 'PUBLISHED',
        name: { equals: 'BÁSICO', mode: 'insensitive' },
        NOT: { id: TIER_ID },
      })
    })
  })

  describe('gates', () => {
    it('tier inexistente → NotFoundError', async () => {
      tierFindUnique.mockResolvedValue(null)
      await expect(
        setTierVisibilityAction({ tierId: TIER_ID, visibility: 'PUBLISHED' }),
      ).rejects.toThrow(NotFoundError)
    })

    it('actor sin ownership → AuthorizationError', async () => {
      findPlaceOwnershipFn.mockResolvedValue(false)
      await expect(
        setTierVisibilityAction({ tierId: TIER_ID, visibility: 'PUBLISHED' }),
      ).rejects.toThrow(AuthorizationError)
      expect(tierUpdate).not.toHaveBeenCalled()
    })

    it('rechaza visibility fuera del enum', async () => {
      await expect(
        setTierVisibilityAction({ tierId: TIER_ID, visibility: 'DRAFT' as 'HIDDEN' }),
      ).rejects.toThrow(ValidationError)
    })
  })
})
