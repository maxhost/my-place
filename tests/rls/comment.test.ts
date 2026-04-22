import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import {
  closePool,
  insertTestComment,
  insertTestPost,
  resolveE2EUserIds,
  withUser,
} from './harness'
import { E2E_PLACES, type E2ERole } from '../fixtures/e2e-data'

const palermoId = E2E_PLACES.palermo.id
const belgranoId = E2E_PLACES.belgrano.id

describe('RLS: Comment (12 casos)', () => {
  let userIds: Record<E2ERole, string>

  beforeAll(async () => {
    userIds = await resolveE2EUserIds()
  })

  afterAll(async () => {
    await closePool()
  })

  async function seedPostThenComment(
    client: PoolClient,
    placeId: string,
    authorId: string,
    commentId: string,
    opts: { deletedAt?: Date } = {},
  ): Promise<{ postId: string; commentId: string }> {
    const postId = await insertTestPost(client, {
      placeId,
      authorUserId: authorId,
      slug: `rls-c-${commentId}`,
    })
    await insertTestComment(client, {
      id: commentId,
      postId,
      placeId,
      authorUserId: authorId,
      deletedAt: opts.deletedAt ?? null,
    })
    return { postId, commentId }
  }

  // ── SELECT (4) ────────────────────────────────────────────────────────

  it('SELECT: memberA ve comentarios de su place', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "Comment" WHERE id = $1`,
          ['cmt_rls_select_member'],
        )
        expect(rows).toHaveLength(1)
      },
      {
        setup: async (client) =>
          void (await seedPostThenComment(
            client,
            palermoId,
            userIds.memberA,
            'cmt_rls_select_member',
          )),
      },
    )
  })

  it('SELECT: memberA ve incluso comentarios soft-deleted (RLS no filtra deletedAt)', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rows } = await client.query<{ id: string; deletedAt: Date | null }>(
          `SELECT id, "deletedAt" FROM "Comment" WHERE id = $1`,
          ['cmt_rls_select_deleted'],
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]?.deletedAt).not.toBeNull()
      },
      {
        setup: async (client) => {
          await seedPostThenComment(client, palermoId, userIds.memberA, 'cmt_rls_select_deleted', {
            deletedAt: new Date(),
          })
        },
      },
    )
  })

  it('SELECT: ex-member NO ve ningún comentario', async () => {
    await withUser(userIds.exMember, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM "Comment" WHERE "placeId" = $1`,
        [palermoId],
      )
      expect(rows).toHaveLength(0)
    })
  })

  it('SELECT: non-member NO ve comentarios de belgrano', async () => {
    await withUser(userIds.nonMember, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM "Comment" WHERE "placeId" = $1`,
        [belgranoId],
      )
      expect(rows).toHaveLength(0)
    })
  })

  // ── INSERT (3) ────────────────────────────────────────────────────────

  it('INSERT: memberA crea comentario self-author → OK', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rowCount } = await client.query(
          `INSERT INTO "Comment"
             (id, "postId", "placeId", "authorUserId", "authorSnapshot", body, "createdAt", version)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW(), 0)`,
          [
            'cmt_rls_insert_ok',
            'post_rls_for_insert_ok',
            palermoId,
            userIds.memberA,
            JSON.stringify({ displayName: 'memberA', avatarUrl: null }),
            JSON.stringify({ type: 'doc', content: [] }),
          ],
        )
        expect(rowCount).toBe(1)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_for_insert_ok',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-for-insert-ok',
          })
        },
      },
    )
  })

  it('INSERT: memberA impersona a memberB → rejected', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        await expect(
          client.query(
            `INSERT INTO "Comment"
               (id, "postId", "placeId", "authorUserId", "authorSnapshot", body, "createdAt", version)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW(), 0)`,
            [
              'cmt_rls_impersonate',
              'post_rls_imp',
              palermoId,
              userIds.memberB,
              JSON.stringify({ displayName: 'mb', avatarUrl: null }),
              JSON.stringify({ type: 'doc', content: [] }),
            ],
          ),
        ).rejects.toThrow(/row-level security/i)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_imp',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-imp',
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
            `INSERT INTO "Comment"
               (id, "postId", "placeId", "authorUserId", "authorSnapshot", body, "createdAt", version)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW(), 0)`,
            [
              'cmt_rls_nm',
              'post_rls_nm',
              palermoId,
              userIds.nonMember,
              JSON.stringify({ displayName: 'nm', avatarUrl: null }),
              JSON.stringify({ type: 'doc', content: [] }),
            ],
          ),
        ).rejects.toThrow(/row-level security/i)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_nm',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-nm',
          })
        },
      },
    )
  })

  // ── UPDATE (3) ────────────────────────────────────────────────────────

  it('UPDATE: autor edita su comentario → OK', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rowCount } = await client.query(
          `UPDATE "Comment" SET "editedAt" = NOW() WHERE id = $1`,
          ['cmt_rls_update_author'],
        )
        expect(rowCount).toBe(1)
      },
      {
        setup: async (client) =>
          void (await seedPostThenComment(
            client,
            palermoId,
            userIds.memberA,
            'cmt_rls_update_author',
          )),
      },
    )
  })

  it('UPDATE: admin soft-delete comentario ajeno → OK', async () => {
    await withUser(
      userIds.admin,
      async (client) => {
        const { rowCount } = await client.query(
          `UPDATE "Comment" SET "deletedAt" = NOW() WHERE id = $1`,
          ['cmt_rls_update_admin'],
        )
        expect(rowCount).toBe(1)
      },
      {
        setup: async (client) =>
          void (await seedPostThenComment(
            client,
            palermoId,
            userIds.memberA,
            'cmt_rls_update_admin',
          )),
      },
    )
  })

  it('UPDATE: memberB (otro place) NO puede editar comment de palermo → 0 filas', async () => {
    await withUser(
      userIds.memberB,
      async (client) => {
        const { rowCount } = await client.query(
          `UPDATE "Comment" SET "editedAt" = NOW() WHERE id = $1`,
          ['cmt_rls_update_foreign'],
        )
        expect(rowCount).toBe(0)
      },
      {
        setup: async (client) =>
          void (await seedPostThenComment(
            client,
            palermoId,
            userIds.memberA,
            'cmt_rls_update_foreign',
          )),
      },
    )
  })

  // ── DELETE (2): sin policy → denegado para todos ─────────────────────

  it('DELETE: autor NO puede hard-delete su comentario', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rowCount } = await client.query(`DELETE FROM "Comment" WHERE id = $1`, [
          'cmt_rls_delete_author',
        ])
        expect(rowCount).toBe(0)
      },
      {
        setup: async (client) =>
          void (await seedPostThenComment(
            client,
            palermoId,
            userIds.memberA,
            'cmt_rls_delete_author',
          )),
      },
    )
  })

  it('DELETE: admin NO puede hard-delete comentario', async () => {
    await withUser(
      userIds.admin,
      async (client) => {
        const { rowCount } = await client.query(`DELETE FROM "Comment" WHERE id = $1`, [
          'cmt_rls_delete_admin',
        ])
        expect(rowCount).toBe(0)
      },
      {
        setup: async (client) =>
          void (await seedPostThenComment(
            client,
            palermoId,
            userIds.memberA,
            'cmt_rls_delete_admin',
          )),
      },
    )
  })
})
