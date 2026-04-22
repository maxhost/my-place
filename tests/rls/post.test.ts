import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import { closePool, insertTestPost, resolveE2EUserIds, withAnon, withUser } from './harness'
import { E2E_PLACES, type E2ERole } from '../fixtures/e2e-data'

const palermoId = E2E_PLACES.palermo.id
const belgranoId = E2E_PLACES.belgrano.id

describe('RLS: Post (18 casos sobre policies select/insert/update/delete)', () => {
  let userIds: Record<E2ERole, string>

  beforeAll(async () => {
    userIds = await resolveE2EUserIds()
  })

  afterAll(async () => {
    await closePool()
  })

  // ── SELECT ────────────────────────────────────────────────────────────

  it('SELECT: memberA ve posts visibles de su place', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "Post" WHERE "placeId" = $1`,
          [palermoId],
        )
        expect(rows.length).toBeGreaterThan(0)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-visible',
          })
        },
      },
    )
  })

  it('SELECT: memberA NO ve posts hidden (solo admins)', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(`SELECT id FROM "Post" WHERE id = $1`, [
          'post_rls_hidden_target',
        ])
        expect(rows).toHaveLength(0)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_hidden_target',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-hidden',
            hiddenAt: new Date(),
          })
        },
      },
    )
  })

  it('SELECT: admin SÍ ve posts hidden', async () => {
    await withUser(
      userIds.admin,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(`SELECT id FROM "Post" WHERE id = $1`, [
          'post_rls_hidden_admin',
        ])
        expect(rows).toHaveLength(1)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_hidden_admin',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-hidden-admin',
            hiddenAt: new Date(),
          })
        },
      },
    )
  })

  it('SELECT: owner SÍ ve posts hidden en ambos places (via PlaceOwnership)', async () => {
    await withUser(
      userIds.owner,
      async (client) => {
        const { rows: palermoRows } = await client.query<{ id: string }>(
          `SELECT id FROM "Post" WHERE id = $1`,
          ['post_rls_hidden_owner_p'],
        )
        const { rows: belgranoRows } = await client.query<{ id: string }>(
          `SELECT id FROM "Post" WHERE id = $1`,
          ['post_rls_hidden_owner_b'],
        )
        expect(palermoRows).toHaveLength(1)
        expect(belgranoRows).toHaveLength(1)
      },
      {
        setup: async (client: PoolClient) => {
          await insertTestPost(client, {
            id: 'post_rls_hidden_owner_p',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-hidden-p',
            hiddenAt: new Date(),
          })
          await insertTestPost(client, {
            id: 'post_rls_hidden_owner_b',
            placeId: belgranoId,
            authorUserId: userIds.memberB,
            slug: 'rls-hidden-b',
            hiddenAt: new Date(),
          })
        },
      },
    )
  })

  it('SELECT: ex-member NO ve ningún post del place (leftAt bloquea)', async () => {
    await withUser(userIds.exMember, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM "Post" WHERE "placeId" = $1`,
        [palermoId],
      )
      expect(rows).toHaveLength(0)
    })
  })

  it('SELECT: non-member NO ve ningún post de un place al que no pertenece', async () => {
    await withUser(userIds.nonMember, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM "Post" WHERE "placeId" IN ($1, $2)`,
        [palermoId, belgranoId],
      )
      expect(rows).toHaveLength(0)
    })
  })

  // ── INSERT ────────────────────────────────────────────────────────────

  it('INSERT: memberA puede crear post en su place como self-author', async () => {
    await withUser(userIds.memberA, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO "Post"
           (id, "placeId", "authorUserId", "authorSnapshot", title, slug, body,
            "createdAt", "lastActivityAt", version)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, NOW(), NOW(), 0)
         RETURNING id`,
        [
          'post_rls_insert_ok',
          palermoId,
          userIds.memberA,
          JSON.stringify({ displayName: 'memberA', avatarUrl: null }),
          'New post',
          'rls-insert-ok',
          JSON.stringify({ type: 'doc', content: [] }),
        ],
      )
      expect(rows).toHaveLength(1)
    })
  })

  it('INSERT: memberA intenta impersonar a memberB (authorUserId ajeno) → rejected', async () => {
    await withUser(userIds.memberA, async (client) => {
      await expect(
        client.query(
          `INSERT INTO "Post"
             (id, "placeId", "authorUserId", "authorSnapshot", title, slug, body,
              "createdAt", "lastActivityAt", version)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, NOW(), NOW(), 0)`,
          [
            'post_rls_impersonate',
            palermoId,
            userIds.memberB,
            JSON.stringify({ displayName: 'memberB', avatarUrl: null }),
            'Impersonated',
            'rls-impersonate',
            JSON.stringify({ type: 'doc', content: [] }),
          ],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('INSERT: non-member → rejected (no pertenece al place)', async () => {
    await withUser(userIds.nonMember, async (client) => {
      await expect(
        client.query(
          `INSERT INTO "Post"
             (id, "placeId", "authorUserId", "authorSnapshot", title, slug, body,
              "createdAt", "lastActivityAt", version)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, NOW(), NOW(), 0)`,
          [
            'post_rls_nonmember',
            palermoId,
            userIds.nonMember,
            JSON.stringify({ displayName: 'nn', avatarUrl: null }),
            'NM post',
            'rls-nm',
            JSON.stringify({ type: 'doc', content: [] }),
          ],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('INSERT: ex-member → rejected (is_active_member falla por leftAt)', async () => {
    await withUser(userIds.exMember, async (client) => {
      await expect(
        client.query(
          `INSERT INTO "Post"
             (id, "placeId", "authorUserId", "authorSnapshot", title, slug, body,
              "createdAt", "lastActivityAt", version)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, NOW(), NOW(), 0)`,
          [
            'post_rls_exmember',
            palermoId,
            userIds.exMember,
            JSON.stringify({ displayName: 'ex', avatarUrl: null }),
            'Ex post',
            'rls-ex',
            JSON.stringify({ type: 'doc', content: [] }),
          ],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('INSERT: anon → rejected', async () => {
    await withAnon(async (client) => {
      await expect(
        client.query(
          `INSERT INTO "Post"
             (id, "placeId", "authorUserId", "authorSnapshot", title, slug, body,
              "createdAt", "lastActivityAt", version)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, NOW(), NOW(), 0)`,
          [
            'post_rls_anon',
            palermoId,
            userIds.memberA,
            JSON.stringify({ displayName: 'x', avatarUrl: null }),
            'Anon',
            'rls-anon',
            JSON.stringify({ type: 'doc', content: [] }),
          ],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  // ── UPDATE ────────────────────────────────────────────────────────────

  it('UPDATE: autor actualiza su propio post → OK', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rowCount } = await client.query(
          `UPDATE "Post" SET title = 'retitled' WHERE id = $1`,
          ['post_rls_update_author'],
        )
        expect(rowCount).toBe(1)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_update_author',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-update-author',
          })
        },
      },
    )
  })

  it('UPDATE: admin actualiza post ajeno (hide) → OK', async () => {
    await withUser(
      userIds.admin,
      async (client) => {
        const { rowCount } = await client.query(
          `UPDATE "Post" SET "hiddenAt" = NOW() WHERE id = $1`,
          ['post_rls_update_admin'],
        )
        expect(rowCount).toBe(1)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_update_admin',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-update-admin',
          })
        },
      },
    )
  })

  it('UPDATE: owner actualiza post ajeno en ambos places → OK', async () => {
    await withUser(
      userIds.owner,
      async (client) => {
        const p1 = await client.query(`UPDATE "Post" SET "hiddenAt" = NOW() WHERE id = $1`, [
          'post_rls_update_owner_p',
        ])
        const p2 = await client.query(`UPDATE "Post" SET "hiddenAt" = NOW() WHERE id = $1`, [
          'post_rls_update_owner_b',
        ])
        expect(p1.rowCount).toBe(1)
        expect(p2.rowCount).toBe(1)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_update_owner_p',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-update-owner-p',
          })
          await insertTestPost(client, {
            id: 'post_rls_update_owner_b',
            placeId: belgranoId,
            authorUserId: userIds.memberB,
            slug: 'rls-update-owner-b',
          })
        },
      },
    )
  })

  it('UPDATE: memberB en palermo → 0 filas afectadas (no autor, no admin, no del place)', async () => {
    await withUser(
      userIds.memberB,
      async (client) => {
        const { rowCount } = await client.query(
          `UPDATE "Post" SET title = 'hacked' WHERE id = $1`,
          ['post_rls_update_foreign'],
        )
        expect(rowCount).toBe(0)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_update_foreign',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-update-foreign',
          })
        },
      },
    )
  })

  it('UPDATE: ex-member sobre su propio post previo → 0 filas (is_active_member falla)', async () => {
    await withUser(
      userIds.exMember,
      async (client) => {
        const { rowCount } = await client.query(
          `UPDATE "Post" SET title = 'ex edit' WHERE id = $1`,
          ['post_rls_update_ex'],
        )
        expect(rowCount).toBe(0)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_update_ex',
            placeId: palermoId,
            authorUserId: userIds.exMember,
            slug: 'rls-update-ex',
          })
        },
      },
    )
  })

  // ── DELETE (no policy → denegado para todos) ──────────────────────────

  it('DELETE: autor NO puede borrar su post (sin policy de DELETE)', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rowCount } = await client.query(`DELETE FROM "Post" WHERE id = $1`, [
          'post_rls_delete_author',
        ])
        expect(rowCount).toBe(0)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_delete_author',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-delete-author',
          })
        },
      },
    )
  })

  it('DELETE: admin NO puede borrar post', async () => {
    await withUser(
      userIds.admin,
      async (client) => {
        const { rowCount } = await client.query(`DELETE FROM "Post" WHERE id = $1`, [
          'post_rls_delete_admin',
        ])
        expect(rowCount).toBe(0)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_delete_admin',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-delete-admin',
          })
        },
      },
    )
  })

  it('DELETE: owner NO puede borrar post', async () => {
    await withUser(
      userIds.owner,
      async (client) => {
        const { rowCount } = await client.query(`DELETE FROM "Post" WHERE id = $1`, [
          'post_rls_delete_owner',
        ])
        expect(rowCount).toBe(0)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_delete_owner',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-delete-owner',
          })
        },
      },
    )
  })
})
