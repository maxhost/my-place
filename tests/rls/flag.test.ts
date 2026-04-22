import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { closePool, insertTestFlag, insertTestPost, resolveE2EUserIds, withUser } from './harness'
import { E2E_PLACES, type E2ERole } from '../fixtures/e2e-data'

const palermoId = E2E_PLACES.palermo.id
const belgranoId = E2E_PLACES.belgrano.id

describe('RLS: Flag (14 casos)', () => {
  let userIds: Record<E2ERole, string>

  beforeAll(async () => {
    userIds = await resolveE2EUserIds()
  })

  afterAll(async () => {
    await closePool()
  })

  async function seedFlagByReporter(
    client: PoolClient,
    placeId: string,
    reporterId: string,
    flagId: string,
  ): Promise<void> {
    const postId = await insertTestPost(client, {
      placeId,
      authorUserId: reporterId === userIds.memberA ? userIds.memberB : userIds.memberA,
      slug: `rls-flag-${flagId}`,
    })
    await insertTestFlag(client, {
      id: flagId,
      targetType: 'POST',
      targetId: postId,
      placeId,
      reporterUserId: reporterId,
    })
  }

  // ── SELECT (6) ────────────────────────────────────────────────────────

  it('SELECT: reporter (memberA) ve su propio flag', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(`SELECT id FROM "Flag" WHERE id = $1`, [
          'flag_rls_own',
        ])
        expect(rows).toHaveLength(1)
      },
      {
        setup: async (client) => {
          await seedFlagByReporter(client, palermoId, userIds.memberA, 'flag_rls_own')
        },
      },
    )
  })

  it('SELECT: memberA NO ve flag ajeno de otro user en su place', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(`SELECT id FROM "Flag" WHERE id = $1`, [
          'flag_rls_foreign',
        ])
        expect(rows).toHaveLength(0)
      },
      {
        setup: async (client) => {
          // admin filed a flag in palermo; memberA (different reporter, not admin) shouldn't see it.
          await seedFlagByReporter(client, palermoId, userIds.admin, 'flag_rls_foreign')
        },
      },
    )
  })

  it('SELECT: admin ve todos los flags de su place', async () => {
    await withUser(
      userIds.admin,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "Flag" WHERE id IN ($1, $2)`,
          ['flag_rls_admin_own', 'flag_rls_admin_other'],
        )
        expect(rows).toHaveLength(2)
      },
      {
        setup: async (client) => {
          await seedFlagByReporter(client, palermoId, userIds.memberA, 'flag_rls_admin_own')
          await seedFlagByReporter(client, palermoId, userIds.exMember, 'flag_rls_admin_other')
        },
      },
    )
  })

  it('SELECT: owner ve flags en ambos places', async () => {
    await withUser(
      userIds.owner,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "Flag" WHERE id IN ($1, $2)`,
          ['flag_rls_owner_p', 'flag_rls_owner_b'],
        )
        expect(rows).toHaveLength(2)
      },
      {
        setup: async (client) => {
          await seedFlagByReporter(client, palermoId, userIds.memberA, 'flag_rls_owner_p')
          await seedFlagByReporter(client, belgranoId, userIds.memberB, 'flag_rls_owner_b')
        },
      },
    )
  })

  it('SELECT: non-member NO ve flags', async () => {
    await withUser(
      userIds.nonMember,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(`SELECT id FROM "Flag" WHERE id = $1`, [
          'flag_rls_nm',
        ])
        expect(rows).toHaveLength(0)
      },
      {
        setup: async (client) => {
          await seedFlagByReporter(client, palermoId, userIds.memberA, 'flag_rls_nm')
        },
      },
    )
  })

  it('SELECT: ex-member SÍ ve sus propios flags antiguos (policy no chequea is_active_member)', async () => {
    await withUser(
      userIds.exMember,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(`SELECT id FROM "Flag" WHERE id = $1`, [
          'flag_rls_ex_own',
        ])
        expect(rows).toHaveLength(1)
      },
      {
        setup: async (client) => {
          await seedFlagByReporter(client, palermoId, userIds.exMember, 'flag_rls_ex_own')
        },
      },
    )
  })

  // ── INSERT (3) ────────────────────────────────────────────────────────

  it('INSERT: memberA reporta self-reporter → OK', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rowCount } = await client.query(
          `INSERT INTO "Flag"
             (id, "targetType", "targetId", "placeId", "reporterUserId", reason, status, "createdAt")
           VALUES ($1, $2::"ContentTargetKind", $3, $4, $5, $6::"FlagReason", $7::"FlagStatus", NOW())`,
          [
            'flag_rls_insert_ok',
            'POST',
            'post_rls_flag_ok',
            palermoId,
            userIds.memberA,
            'SPAM',
            'OPEN',
          ],
        )
        expect(rowCount).toBe(1)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_flag_ok',
            placeId: palermoId,
            authorUserId: userIds.memberB,
            slug: 'rls-flag-ok',
          })
        },
      },
    )
  })

  it('INSERT: memberA impersona reporter ajeno → rejected', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        await expect(
          client.query(
            `INSERT INTO "Flag"
               (id, "targetType", "targetId", "placeId", "reporterUserId", reason, status, "createdAt")
             VALUES ($1, $2::"ContentTargetKind", $3, $4, $5, $6::"FlagReason", $7::"FlagStatus", NOW())`,
            ['flag_rls_imp', 'POST', 'post_rls_flag_imp', palermoId, userIds.admin, 'SPAM', 'OPEN'],
          ),
        ).rejects.toThrow(/row-level security/i)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_flag_imp',
            placeId: palermoId,
            authorUserId: userIds.memberB,
            slug: 'rls-flag-imp',
          })
        },
      },
    )
  })

  it('INSERT: non-member → rejected', async () => {
    await withUser(
      userIds.nonMember,
      async (client) => {
        await expect(
          client.query(
            `INSERT INTO "Flag"
               (id, "targetType", "targetId", "placeId", "reporterUserId", reason, status, "createdAt")
             VALUES ($1, $2::"ContentTargetKind", $3, $4, $5, $6::"FlagReason", $7::"FlagStatus", NOW())`,
            [
              'flag_rls_nm_insert',
              'POST',
              'post_rls_flag_nm',
              palermoId,
              userIds.nonMember,
              'SPAM',
              'OPEN',
            ],
          ),
        ).rejects.toThrow(/row-level security/i)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_flag_nm',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-flag-nm',
          })
        },
      },
    )
  })

  // ── UPDATE (3) ────────────────────────────────────────────────────────

  it('UPDATE: admin cierra flag → OK', async () => {
    await withUser(
      userIds.admin,
      async (client) => {
        const { rowCount } = await client.query(
          `UPDATE "Flag" SET status = 'REVIEWED_DISMISSED'::"FlagStatus", "reviewedAt" = NOW(), "reviewerAdminUserId" = $2 WHERE id = $1`,
          ['flag_rls_update_admin', userIds.admin],
        )
        expect(rowCount).toBe(1)
      },
      {
        setup: async (client) => {
          await seedFlagByReporter(client, palermoId, userIds.memberA, 'flag_rls_update_admin')
        },
      },
    )
  })

  it('UPDATE: reporter (memberA) NO puede updatear su propio flag (solo admin) → 0 filas', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rowCount } = await client.query(
          `UPDATE "Flag" SET status = 'REVIEWED_DISMISSED'::"FlagStatus" WHERE id = $1`,
          ['flag_rls_update_reporter'],
        )
        expect(rowCount).toBe(0)
      },
      {
        setup: async (client) => {
          await seedFlagByReporter(client, palermoId, userIds.memberA, 'flag_rls_update_reporter')
        },
      },
    )
  })

  it('UPDATE: owner puede cerrar flag → OK', async () => {
    await withUser(
      userIds.owner,
      async (client) => {
        const { rowCount } = await client.query(
          `UPDATE "Flag"
             SET status = 'REVIEWED_ACTIONED'::"FlagStatus",
                 "reviewedAt" = NOW(),
                 "reviewerAdminUserId" = $2
             WHERE id = $1`,
          ['flag_rls_update_owner', userIds.owner],
        )
        expect(rowCount).toBe(1)
      },
      {
        setup: async (client) => {
          await seedFlagByReporter(client, palermoId, userIds.memberA, 'flag_rls_update_owner')
        },
      },
    )
  })

  // ── DELETE (2): sin policy → denegado para todos ─────────────────────

  it('DELETE: admin NO puede borrar flag', async () => {
    await withUser(
      userIds.admin,
      async (client) => {
        const { rowCount } = await client.query(`DELETE FROM "Flag" WHERE id = $1`, [
          'flag_rls_delete_admin',
        ])
        expect(rowCount).toBe(0)
      },
      {
        setup: async (client) => {
          await seedFlagByReporter(client, palermoId, userIds.memberA, 'flag_rls_delete_admin')
        },
      },
    )
  })

  it('DELETE: reporter NO puede borrar su flag', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rowCount } = await client.query(`DELETE FROM "Flag" WHERE id = $1`, [
          'flag_rls_delete_reporter',
        ])
        expect(rowCount).toBe(0)
      },
      {
        setup: async (client) => {
          await seedFlagByReporter(client, palermoId, userIds.memberA, 'flag_rls_delete_reporter')
        },
      },
    )
  })
})
