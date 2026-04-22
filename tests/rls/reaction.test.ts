import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  closePool,
  insertTestPost,
  insertTestReaction,
  resolveE2EUserIds,
  withUser,
} from './harness'
import { E2E_PLACES, type E2ERole } from '../fixtures/e2e-data'

const palermoId = E2E_PLACES.palermo.id

describe('RLS: Reaction (8 casos)', () => {
  let userIds: Record<E2ERole, string>

  beforeAll(async () => {
    userIds = await resolveE2EUserIds()
  })

  afterAll(async () => {
    await closePool()
  })

  // ── SELECT (2) ────────────────────────────────────────────────────────

  it('SELECT: memberA ve reacciones de su place', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "Reaction" WHERE id = $1`,
          ['rx_rls_select'],
        )
        expect(rows).toHaveLength(1)
      },
      {
        setup: async (client) => {
          const postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-rx-select',
          })
          await insertTestReaction(client, {
            id: 'rx_rls_select',
            targetType: 'POST',
            targetId: postId,
            placeId: palermoId,
            userId: userIds.memberA,
          })
        },
      },
    )
  })

  it('SELECT: non-member NO ve reacciones de palermo', async () => {
    await withUser(
      userIds.nonMember,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "Reaction" WHERE id = $1`,
          ['rx_rls_select_nm'],
        )
        expect(rows).toHaveLength(0)
      },
      {
        setup: async (client) => {
          const postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-rx-select-nm',
          })
          await insertTestReaction(client, {
            id: 'rx_rls_select_nm',
            targetType: 'POST',
            targetId: postId,
            placeId: palermoId,
            userId: userIds.memberA,
          })
        },
      },
    )
  })

  // ── INSERT (3) ────────────────────────────────────────────────────────

  it('INSERT: memberA reacciona como self → OK', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rowCount } = await client.query(
          `INSERT INTO "Reaction"
             (id, "targetType", "targetId", "placeId", "userId", emoji, "createdAt")
           VALUES ($1, $2::"ContentTargetKind", $3, $4, $5, $6::"ReactionEmoji", NOW())`,
          ['rx_rls_insert_ok', 'POST', 'post_rls_rx_ok', palermoId, userIds.memberA, 'HEART'],
        )
        expect(rowCount).toBe(1)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_rx_ok',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-rx-ok',
          })
        },
      },
    )
  })

  it('INSERT: memberA impersona userId ajeno → rejected', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        await expect(
          client.query(
            `INSERT INTO "Reaction"
               (id, "targetType", "targetId", "placeId", "userId", emoji, "createdAt")
             VALUES ($1, $2::"ContentTargetKind", $3, $4, $5, $6::"ReactionEmoji", NOW())`,
            ['rx_rls_imp', 'POST', 'post_rls_rx_imp', palermoId, userIds.memberB, 'HEART'],
          ),
        ).rejects.toThrow(/row-level security/i)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_rx_imp',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-rx-imp',
          })
        },
      },
    )
  })

  it('INSERT: ex-member NO puede reaccionar (is_active_member falla)', async () => {
    await withUser(
      userIds.exMember,
      async (client) => {
        await expect(
          client.query(
            `INSERT INTO "Reaction"
               (id, "targetType", "targetId", "placeId", "userId", emoji, "createdAt")
             VALUES ($1, $2::"ContentTargetKind", $3, $4, $5, $6::"ReactionEmoji", NOW())`,
            ['rx_rls_ex', 'POST', 'post_rls_rx_ex', palermoId, userIds.exMember, 'HEART'],
          ),
        ).rejects.toThrow(/row-level security/i)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_rx_ex',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-rx-ex',
          })
        },
      },
    )
  })

  // ── DELETE (2) ────────────────────────────────────────────────────────

  it('DELETE: user borra su propia reacción → OK', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rowCount } = await client.query(`DELETE FROM "Reaction" WHERE id = $1`, [
          'rx_rls_delete_self',
        ])
        expect(rowCount).toBe(1)
      },
      {
        setup: async (client) => {
          const postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-rx-del-self',
          })
          await insertTestReaction(client, {
            id: 'rx_rls_delete_self',
            targetType: 'POST',
            targetId: postId,
            placeId: palermoId,
            userId: userIds.memberA,
          })
        },
      },
    )
  })

  it('DELETE: user NO puede borrar reacción ajena → 0 filas', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rowCount } = await client.query(`DELETE FROM "Reaction" WHERE id = $1`, [
          'rx_rls_delete_foreign',
        ])
        expect(rowCount).toBe(0)
      },
      {
        setup: async (client) => {
          const postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-rx-del-foreign',
          })
          await insertTestReaction(client, {
            id: 'rx_rls_delete_foreign',
            targetType: 'POST',
            targetId: postId,
            placeId: palermoId,
            userId: userIds.admin,
          })
        },
      },
    )
  })

  // ── UPDATE (1): sin policy → denegado ─────────────────────────────────

  it('UPDATE: no hay policy → 0 filas (aunque fuera propia)', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rowCount } = await client.query(
          `UPDATE "Reaction" SET emoji = 'LAUGH'::"ReactionEmoji" WHERE id = $1`,
          ['rx_rls_update'],
        )
        expect(rowCount).toBe(0)
      },
      {
        setup: async (client) => {
          const postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-rx-upd',
          })
          await insertTestReaction(client, {
            id: 'rx_rls_update',
            targetType: 'POST',
            targetId: postId,
            placeId: palermoId,
            userId: userIds.memberA,
          })
        },
      },
    )
  })
})
