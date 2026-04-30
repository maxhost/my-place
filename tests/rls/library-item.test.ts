import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  closePool,
  insertTestLibraryCategory,
  insertTestLibraryContributor,
  insertTestLibraryItem,
  insertTestPost,
  resolveE2EUserIds,
  withUser,
} from './harness'
import { E2E_PLACES, type E2ERole } from '../fixtures/e2e-data'

const palermoId = E2E_PLACES.palermo.id
const belgranoId = E2E_PLACES.belgrano.id

/**
 * RLS: LibraryItem (R.7.5).
 *
 * Cubre las 3 policies definidas en
 * `prisma/migrations/20260430010000_library_items/migration.sql`:
 *
 *   - SELECT: member ve no archivadas; admin ve todas; non-member nada.
 *   - INSERT: replica matriz canCreateInCategory (admin | designated |
 *     members_open) + valida `authorUserId = auth.uid()`.
 *   - UPDATE: admin del place o author directo (sin sub-query — author
 *     denormalizado en LibraryItem.authorUserId).
 *   - DELETE: bloqueado para authenticated.
 */
describe('RLS: LibraryItem (R.7.5)', () => {
  let userIds: Record<E2ERole, string>

  beforeAll(async () => {
    userIds = await resolveE2EUserIds()
  })

  afterAll(async () => {
    await closePool()
  })

  // ── SELECT ────────────────────────────────────────────────────────────

  it('1. SELECT: memberA ve items no archivados del place', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "LibraryItem" WHERE "placeId" = $1`,
          [palermoId],
        )
        expect(rows.length).toBeGreaterThan(0)
      },
      {
        setup: async (client) => {
          const categoryId = await insertTestLibraryCategory(client, { placeId: palermoId })
          const postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
          })
          await insertTestLibraryItem(client, {
            placeId: palermoId,
            categoryId,
            postId,
            authorUserId: userIds.memberA,
          })
        },
      },
    )
  })

  it('2. SELECT: nonMember NO ve items de places ajenos', async () => {
    await withUser(
      userIds.nonMember,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "LibraryItem" WHERE "placeId" IN ($1, $2)`,
          [palermoId, belgranoId],
        )
        expect(rows).toHaveLength(0)
      },
      {
        setup: async (client) => {
          const categoryId = await insertTestLibraryCategory(client, { placeId: palermoId })
          const postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
          })
          await insertTestLibraryItem(client, {
            placeId: palermoId,
            categoryId,
            postId,
            authorUserId: userIds.memberA,
          })
        },
      },
    )
  })

  it('3. SELECT: archivada visible para admin + author, oculta para otros members', async () => {
    let archivedId: string

    // memberB (no author de este item) NO la ve
    await withUser(
      userIds.memberB,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "LibraryItem" WHERE id = $1`,
          [archivedId],
        )
        expect(rows).toHaveLength(0)
      },
      {
        setup: async (client) => {
          const categoryId = await insertTestLibraryCategory(client, { placeId: palermoId })
          const postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
          })
          archivedId = await insertTestLibraryItem(client, {
            placeId: palermoId,
            categoryId,
            postId,
            authorUserId: userIds.memberA,
            archivedAt: new Date(Date.now() - 60_000),
          })
        },
      },
    )

    // memberA (author) SÍ la ve — necesario para que pueda restaurar/editar
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "LibraryItem" WHERE id = $1`,
          [archivedId],
        )
        expect(rows).toHaveLength(1)
      },
      {
        setup: async (client) => {
          const categoryId = await insertTestLibraryCategory(client, { placeId: palermoId })
          const postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
          })
          archivedId = await insertTestLibraryItem(client, {
            placeId: palermoId,
            categoryId,
            postId,
            authorUserId: userIds.memberA,
            archivedAt: new Date(Date.now() - 60_000),
          })
        },
      },
    )

    // admin SÍ la ve
    await withUser(
      userIds.admin,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "LibraryItem" WHERE id = $1`,
          [archivedId],
        )
        expect(rows).toHaveLength(1)
      },
      {
        setup: async (client) => {
          const categoryId = await insertTestLibraryCategory(client, { placeId: palermoId })
          const postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
          })
          archivedId = await insertTestLibraryItem(client, {
            placeId: palermoId,
            categoryId,
            postId,
            authorUserId: userIds.memberA,
            archivedAt: new Date(Date.now() - 60_000),
          })
        },
      },
    )
  })

  // ── INSERT (matriz canCreateInCategory) ──────────────────────────────

  it('4. INSERT: admin crea item en categoría ADMIN_ONLY OK', async () => {
    let categoryId: string
    let postId: string
    await withUser(
      userIds.admin,
      async (client) => {
        const r = await client.query(
          `INSERT INTO "LibraryItem"
            (id, "placeId", "categoryId", "postId", "authorUserId", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           RETURNING id`,
          ['libitem_admin', palermoId, categoryId, postId, userIds.admin],
        )
        expect(r.rows).toHaveLength(1)
      },
      {
        setup: async (client) => {
          categoryId = await insertTestLibraryCategory(client, {
            placeId: palermoId,
            contributionPolicy: 'ADMIN_ONLY',
          })
          postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.admin,
          })
        },
      },
    )
  })

  it('5. INSERT: memberA NO crea en categoría ADMIN_ONLY', async () => {
    let categoryId: string
    let postId: string
    await withUser(
      userIds.memberA,
      async (client) => {
        await expect(
          client.query(
            `INSERT INTO "LibraryItem"
              (id, "placeId", "categoryId", "postId", "authorUserId", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
            ['libitem_member_blocked', palermoId, categoryId, postId, userIds.memberA],
          ),
        ).rejects.toThrow(/row-level security/i)
      },
      {
        setup: async (client) => {
          categoryId = await insertTestLibraryCategory(client, {
            placeId: palermoId,
            contributionPolicy: 'ADMIN_ONLY',
          })
          postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
          })
        },
      },
    )
  })

  it('6. INSERT: memberA crea en categoría MEMBERS_OPEN OK', async () => {
    let categoryId: string
    let postId: string
    await withUser(
      userIds.memberA,
      async (client) => {
        const r = await client.query(
          `INSERT INTO "LibraryItem"
            (id, "placeId", "categoryId", "postId", "authorUserId", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           RETURNING id`,
          ['libitem_open', palermoId, categoryId, postId, userIds.memberA],
        )
        expect(r.rows).toHaveLength(1)
      },
      {
        setup: async (client) => {
          categoryId = await insertTestLibraryCategory(client, {
            placeId: palermoId,
            contributionPolicy: 'MEMBERS_OPEN',
          })
          postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
          })
        },
      },
    )
  })

  it('7. INSERT: designated en su categoría OK; otro miembro bloqueado', async () => {
    let categoryId: string
    let postIdA: string
    let postIdB: string

    await withUser(
      userIds.memberA,
      async (client) => {
        const r = await client.query(
          `INSERT INTO "LibraryItem"
            (id, "placeId", "categoryId", "postId", "authorUserId", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           RETURNING id`,
          ['libitem_des_a', palermoId, categoryId, postIdA, userIds.memberA],
        )
        expect(r.rows).toHaveLength(1)
      },
      {
        setup: async (client) => {
          categoryId = await insertTestLibraryCategory(client, {
            placeId: palermoId,
            contributionPolicy: 'DESIGNATED',
          })
          await insertTestLibraryContributor(client, {
            categoryId,
            userId: userIds.memberA,
            invitedByUserId: userIds.admin,
          })
          postIdA = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
          })
        },
      },
    )

    await withUser(
      userIds.memberB,
      async (client) => {
        await expect(
          client.query(
            `INSERT INTO "LibraryItem"
              (id, "placeId", "categoryId", "postId", "authorUserId", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
            ['libitem_des_b_blocked', palermoId, categoryId, postIdB, userIds.memberB],
          ),
        ).rejects.toThrow(/row-level security/i)
      },
      {
        setup: async (client) => {
          categoryId = await insertTestLibraryCategory(client, {
            placeId: palermoId,
            contributionPolicy: 'DESIGNATED',
          })
          await insertTestLibraryContributor(client, {
            categoryId,
            userId: userIds.memberA,
            invitedByUserId: userIds.admin,
          })
          postIdB = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberB,
          })
        },
      },
    )
  })

  it('8. INSERT: members_open con authorUserId de otro user → bloqueado', async () => {
    let categoryId: string
    let postId: string
    await withUser(
      userIds.memberA,
      async (client) => {
        await expect(
          client.query(
            `INSERT INTO "LibraryItem"
              (id, "placeId", "categoryId", "postId", "authorUserId", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
            ['libitem_steal', palermoId, categoryId, postId, userIds.memberB],
          ),
        ).rejects.toThrow(/row-level security/i)
      },
      {
        setup: async (client) => {
          categoryId = await insertTestLibraryCategory(client, {
            placeId: palermoId,
            contributionPolicy: 'MEMBERS_OPEN',
          })
          postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberB,
          })
        },
      },
    )
  })

  // ── UPDATE ────────────────────────────────────────────────────────────

  it('9. UPDATE: author puede archivar su item', async () => {
    let itemId: string
    await withUser(
      userIds.memberA,
      async (client) => {
        const r = await client.query(
          `UPDATE "LibraryItem" SET "archivedAt" = NOW() WHERE id = $1`,
          [itemId],
        )
        expect(r.rowCount).toBe(1)
      },
      {
        setup: async (client) => {
          const categoryId = await insertTestLibraryCategory(client, {
            placeId: palermoId,
            contributionPolicy: 'MEMBERS_OPEN',
          })
          const postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
          })
          itemId = await insertTestLibraryItem(client, {
            placeId: palermoId,
            categoryId,
            postId,
            authorUserId: userIds.memberA,
          })
        },
      },
    )
  })

  it('10. UPDATE: admin actualiza item de otro author OK', async () => {
    let itemId: string
    await withUser(
      userIds.admin,
      async (client) => {
        const r = await client.query(
          `UPDATE "LibraryItem" SET "archivedAt" = NOW() WHERE id = $1`,
          [itemId],
        )
        expect(r.rowCount).toBe(1)
      },
      {
        setup: async (client) => {
          const categoryId = await insertTestLibraryCategory(client, { placeId: palermoId })
          const postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
          })
          itemId = await insertTestLibraryItem(client, {
            placeId: palermoId,
            categoryId,
            postId,
            authorUserId: userIds.memberA,
          })
        },
      },
    )
  })

  it('11. UPDATE: memberB (no author, no admin) NO puede modificar', async () => {
    let itemId: string
    await withUser(
      userIds.memberB,
      async (client) => {
        const r = await client.query(
          `UPDATE "LibraryItem" SET "archivedAt" = NOW() WHERE id = $1`,
          [itemId],
        )
        expect(r.rowCount).toBe(0)
      },
      {
        setup: async (client) => {
          const categoryId = await insertTestLibraryCategory(client, { placeId: palermoId })
          const postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
          })
          itemId = await insertTestLibraryItem(client, {
            placeId: palermoId,
            categoryId,
            postId,
            authorUserId: userIds.memberA,
          })
        },
      },
    )
  })

  // ── DELETE ────────────────────────────────────────────────────────────

  it('12. DELETE: admin NO puede DELETE físico (no policy DELETE)', async () => {
    let itemId: string
    await withUser(
      userIds.admin,
      async (client) => {
        const r = await client.query(`DELETE FROM "LibraryItem" WHERE id = $1`, [itemId])
        expect(r.rowCount).toBe(0)
      },
      {
        setup: async (client) => {
          const categoryId = await insertTestLibraryCategory(client, { placeId: palermoId })
          const postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
          })
          itemId = await insertTestLibraryItem(client, {
            placeId: palermoId,
            categoryId,
            postId,
            authorUserId: userIds.memberA,
          })
        },
      },
    )
  })
})
