import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, insertTestOpening, resolveE2EUserIds, withUser } from './harness'
import { E2E_PLACES, type E2ERole } from '../fixtures/e2e-data'

const palermoId = E2E_PLACES.palermo.id
const belgranoId = E2E_PLACES.belgrano.id

describe('RLS: PlaceOpening (5 casos)', () => {
  let userIds: Record<E2ERole, string>

  beforeAll(async () => {
    userIds = await resolveE2EUserIds()
  })

  afterAll(async () => {
    await closePool()
  })

  // ── SELECT ────────────────────────────────────────────────────────────

  it('SELECT: memberA ve openings de su place', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "PlaceOpening" WHERE id = $1`,
          ['opening_rls_member'],
        )
        expect(rows).toHaveLength(1)
      },
      {
        setup: async (client) => {
          await insertTestOpening(client, {
            id: 'opening_rls_member',
            placeId: palermoId,
          })
        },
      },
    )
  })

  it('SELECT: ex-member NO ve openings (leftAt bloquea)', async () => {
    await withUser(
      userIds.exMember,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "PlaceOpening" WHERE id = $1`,
          ['opening_rls_ex'],
        )
        expect(rows).toHaveLength(0)
      },
      {
        setup: async (client) => {
          await insertTestOpening(client, {
            id: 'opening_rls_ex',
            placeId: palermoId,
          })
        },
      },
    )
  })

  it('SELECT: non-member NO ve openings de belgrano', async () => {
    await withUser(userIds.nonMember, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM "PlaceOpening" WHERE "placeId" = $1`,
        [belgranoId],
      )
      expect(rows).toHaveLength(0)
    })
  })

  // ── INSERT / UPDATE / DELETE: sin policy → todos denegados ────────────

  it('INSERT: admin NO puede INSERT (reservado a service_role)', async () => {
    await withUser(userIds.admin, async (client) => {
      await expect(
        client.query(
          `INSERT INTO "PlaceOpening" (id, "placeId", "startAt", source, "createdAt")
           VALUES ($1, $2, NOW(), 'ALWAYS_OPEN'::"PlaceOpeningSource", NOW())`,
          ['opening_rls_insert_admin', palermoId],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('UPDATE: admin NO puede modificar opening → 0 filas (sin policy)', async () => {
    await withUser(
      userIds.admin,
      async (client) => {
        const { rowCount } = await client.query(
          `UPDATE "PlaceOpening" SET "endAt" = NOW() WHERE id = $1`,
          ['opening_rls_update'],
        )
        expect(rowCount).toBe(0)
      },
      {
        setup: async (client) => {
          await insertTestOpening(client, {
            id: 'opening_rls_update',
            placeId: palermoId,
          })
        },
      },
    )
  })
})
