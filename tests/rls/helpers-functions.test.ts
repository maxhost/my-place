import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, pool, resolveE2EUserIds, withAnon, withUser } from './harness'
import { E2E_PLACES, type E2ERole } from '../fixtures/e2e-data'

const palermoId = E2E_PLACES.palermo.id
const belgranoId = E2E_PLACES.belgrano.id

describe('public.is_active_member(place_id) / public.is_place_admin(place_id)', () => {
  let userIds: Record<E2ERole, string>

  beforeAll(async () => {
    userIds = await resolveE2EUserIds()
  })

  afterAll(async () => {
    await closePool()
  })

  it('anon → false (no claim JWT)', async () => {
    await withAnon(async (client) => {
      const { rows: m } = await client.query<{ r: boolean }>(
        `SELECT public.is_active_member($1) AS r`,
        [palermoId],
      )
      const { rows: a } = await client.query<{ r: boolean }>(
        `SELECT public.is_place_admin($1) AS r`,
        [palermoId],
      )
      expect(m[0]?.r).toBe(false)
      expect(a[0]?.r).toBe(false)
    })
  })

  it('owner: member=true y admin=true en AMBOS places (via PlaceOwnership)', async () => {
    await withUser(userIds.owner, async (client) => {
      for (const pid of [palermoId, belgranoId]) {
        const m = (
          await client.query<{ r: boolean }>(`SELECT public.is_active_member($1) AS r`, [pid])
        ).rows[0]
        const a = (
          await client.query<{ r: boolean }>(`SELECT public.is_place_admin($1) AS r`, [pid])
        ).rows[0]
        expect(m?.r).toBe(true)
        expect(a?.r).toBe(true)
      }
    })
  })

  it('admin: member=true y admin=true en palermo, false en belgrano', async () => {
    await withUser(userIds.admin, async (client) => {
      const mPalermo = (
        await client.query<{ r: boolean }>(`SELECT public.is_active_member($1) AS r`, [palermoId])
      ).rows[0]
      const aPalermo = (
        await client.query<{ r: boolean }>(`SELECT public.is_place_admin($1) AS r`, [palermoId])
      ).rows[0]
      const mBelgrano = (
        await client.query<{ r: boolean }>(`SELECT public.is_active_member($1) AS r`, [belgranoId])
      ).rows[0]
      const aBelgrano = (
        await client.query<{ r: boolean }>(`SELECT public.is_place_admin($1) AS r`, [belgranoId])
      ).rows[0]
      expect(mPalermo?.r).toBe(true)
      expect(aPalermo?.r).toBe(true)
      expect(mBelgrano?.r).toBe(false)
      expect(aBelgrano?.r).toBe(false)
    })
  })

  it('memberA: member=true en palermo pero admin=false', async () => {
    await withUser(userIds.memberA, async (client) => {
      const m = (
        await client.query<{ r: boolean }>(`SELECT public.is_active_member($1) AS r`, [palermoId])
      ).rows[0]
      const a = (
        await client.query<{ r: boolean }>(`SELECT public.is_place_admin($1) AS r`, [palermoId])
      ).rows[0]
      expect(m?.r).toBe(true)
      expect(a?.r).toBe(false)
    })
  })

  it('memberA en belgrano: member=false (aislamiento cross-place)', async () => {
    await withUser(userIds.memberA, async (client) => {
      const m = (
        await client.query<{ r: boolean }>(`SELECT public.is_active_member($1) AS r`, [belgranoId])
      ).rows[0]
      expect(m?.r).toBe(false)
    })
  })

  it('exMember: member=false (leftAt not null) en su antiguo place', async () => {
    await withUser(userIds.exMember, async (client) => {
      const m = (
        await client.query<{ r: boolean }>(`SELECT public.is_active_member($1) AS r`, [palermoId])
      ).rows[0]
      const a = (
        await client.query<{ r: boolean }>(`SELECT public.is_place_admin($1) AS r`, [palermoId])
      ).rows[0]
      expect(m?.r).toBe(false)
      expect(a?.r).toBe(false)
    })
  })

  it('nonMember: member=false en todo place', async () => {
    await withUser(userIds.nonMember, async (client) => {
      for (const pid of [palermoId, belgranoId]) {
        const m = (
          await client.query<{ r: boolean }>(`SELECT public.is_active_member($1) AS r`, [pid])
        ).rows[0]
        expect(m?.r).toBe(false)
      }
    })
  })

  it('pool sigue vivo tras casos previos (sanity)', async () => {
    const { rows } = await pool.query<{ ok: number }>('SELECT 1 AS ok')
    expect(rows[0]?.ok).toBe(1)
  })
})
