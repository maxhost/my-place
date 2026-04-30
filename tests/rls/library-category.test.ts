import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  closePool,
  insertTestLibraryCategory,
  insertTestLibraryContributor,
  resolveE2EUserIds,
  withUser,
} from './harness'
import { E2E_PLACES, type E2ERole } from '../fixtures/e2e-data'

const palermoId = E2E_PLACES.palermo.id
const belgranoId = E2E_PLACES.belgrano.id

/**
 * RLS: LibraryCategory + LibraryCategoryContributor (R.7.1).
 *
 * Cubre las 6 policies definidas en
 * `prisma/migrations/20260430000000_library_categories/migration.sql`:
 *
 *   - LibraryCategory: SELECT (member ve, archivada solo admin), INSERT
 *     (solo admin), UPDATE (solo admin), DELETE bloqueado.
 *   - LibraryCategoryContributor: SELECT (member transparente), INSERT
 *     (solo admin), DELETE (solo admin), UPDATE bloqueado.
 *
 * Aislamiento cross-place via `is_active_member` (helper compartido,
 * mismo precedente que events). Tests usan placeholder data dentro de tx
 * con setup como postgres super → switch a authenticated.
 */
describe('RLS: LibraryCategory + LibraryCategoryContributor (R.7.1)', () => {
  let userIds: Record<E2ERole, string>

  beforeAll(async () => {
    userIds = await resolveE2EUserIds()
  })

  afterAll(async () => {
    await closePool()
  })

  // ── LibraryCategory: SELECT ───────────────────────────────────────────

  it('1. SELECT: memberA ve categorías no archivadas del place', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "LibraryCategory" WHERE "placeId" = $1`,
          [palermoId],
        )
        expect(rows.length).toBeGreaterThan(0)
      },
      {
        setup: async (client) => {
          await insertTestLibraryCategory(client, { placeId: palermoId })
        },
      },
    )
  })

  it('2. SELECT: nonMember NO ve categorías de places ajenos', async () => {
    await withUser(
      userIds.nonMember,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "LibraryCategory" WHERE "placeId" IN ($1, $2)`,
          [palermoId, belgranoId],
        )
        expect(rows).toHaveLength(0)
      },
      {
        setup: async (client) => {
          await insertTestLibraryCategory(client, { placeId: palermoId })
          await insertTestLibraryCategory(client, { placeId: belgranoId })
        },
      },
    )
  })

  it('3. SELECT: exMember NO ve categorías del place que dejó', async () => {
    await withUser(
      userIds.exMember,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "LibraryCategory" WHERE "placeId" = $1`,
          [palermoId],
        )
        expect(rows).toHaveLength(0)
      },
      {
        setup: async (client) => {
          await insertTestLibraryCategory(client, { placeId: palermoId })
        },
      },
    )
  })

  it('4. SELECT: member NO ve archivadas; admin SÍ las ve', async () => {
    let archivedCategoryId: string

    // Como member, no debe ver la archivada.
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "LibraryCategory" WHERE id = $1`,
          [archivedCategoryId],
        )
        expect(rows).toHaveLength(0)
      },
      {
        setup: async (client) => {
          archivedCategoryId = await insertTestLibraryCategory(client, {
            placeId: palermoId,
            archivedAt: new Date(Date.now() - 1000 * 60),
          })
        },
      },
    )

    // Como admin, sí la ve.
    await withUser(
      userIds.admin,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "LibraryCategory" WHERE id = $1`,
          [archivedCategoryId],
        )
        expect(rows).toHaveLength(1)
      },
      {
        setup: async (client) => {
          archivedCategoryId = await insertTestLibraryCategory(client, {
            placeId: palermoId,
            archivedAt: new Date(Date.now() - 1000 * 60),
          })
        },
      },
    )
  })

  // ── LibraryCategory: INSERT ──────────────────────────────────────────

  it('5. INSERT: admin crea categoría OK', async () => {
    await withUser(userIds.admin, async (client) => {
      const r = await client.query(
        `INSERT INTO "LibraryCategory"
          (id, "placeId", slug, emoji, title, "createdAt", "updatedAt")
         VALUES ('libcat_test_admin', $1, 'recetas-admin', '🍳', 'Recetas', NOW(), NOW())
         RETURNING id`,
        [palermoId],
      )
      expect(r.rows).toHaveLength(1)
    })
  })

  it('6. INSERT: owner crea categoría OK', async () => {
    await withUser(userIds.owner, async (client) => {
      const r = await client.query(
        `INSERT INTO "LibraryCategory"
          (id, "placeId", slug, emoji, title, "createdAt", "updatedAt")
         VALUES ('libcat_test_owner', $1, 'recetas-owner', '🍳', 'Recetas owner', NOW(), NOW())
         RETURNING id`,
        [palermoId],
      )
      expect(r.rows).toHaveLength(1)
    })
  })

  it('7. INSERT: memberA NO puede crear categoría (no admin)', async () => {
    await withUser(userIds.memberA, async (client) => {
      await expect(
        client.query(
          `INSERT INTO "LibraryCategory"
            (id, "placeId", slug, emoji, title, "createdAt", "updatedAt")
           VALUES ('libcat_test_member', $1, 'rechazado', '🍳', 'Rechazado', NOW(), NOW())`,
          [palermoId],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('8. INSERT: nonMember NO puede crear categoría', async () => {
    await withUser(userIds.nonMember, async (client) => {
      await expect(
        client.query(
          `INSERT INTO "LibraryCategory"
            (id, "placeId", slug, emoji, title, "createdAt", "updatedAt")
           VALUES ('libcat_test_nonmember', $1, 'rechazado', '🍳', 'Rechazado', NOW(), NOW())`,
          [palermoId],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  // ── LibraryCategory: UPDATE / DELETE ─────────────────────────────────

  it('9. UPDATE: admin actualiza emoji + título OK', async () => {
    let categoryId: string
    await withUser(
      userIds.admin,
      async (client) => {
        const r = await client.query(
          `UPDATE "LibraryCategory" SET emoji = '✨', title = 'Updated' WHERE id = $1 RETURNING id`,
          [categoryId],
        )
        expect(r.rowCount).toBe(1)
      },
      {
        setup: async (client) => {
          categoryId = await insertTestLibraryCategory(client, { placeId: palermoId })
        },
      },
    )
  })

  it('10. UPDATE: memberA NO puede modificar', async () => {
    let categoryId: string
    await withUser(
      userIds.memberA,
      async (client) => {
        const r = await client.query(
          `UPDATE "LibraryCategory" SET title = 'hacked' WHERE id = $1`,
          [categoryId],
        )
        expect(r.rowCount).toBe(0)
      },
      {
        setup: async (client) => {
          categoryId = await insertTestLibraryCategory(client, { placeId: palermoId })
        },
      },
    )
  })

  it('11. DELETE: admin NO puede DELETE físico (no policy de DELETE)', async () => {
    let categoryId: string
    await withUser(
      userIds.admin,
      async (client) => {
        const r = await client.query(`DELETE FROM "LibraryCategory" WHERE id = $1`, [categoryId])
        // Sin policy DELETE → 0 rows afectadas (RLS bloquea por default DENY).
        expect(r.rowCount).toBe(0)
      },
      {
        setup: async (client) => {
          categoryId = await insertTestLibraryCategory(client, { placeId: palermoId })
        },
      },
    )
  })

  // ── LibraryCategoryContributor ───────────────────────────────────────

  it('12. SELECT contributor: memberA ve la lista de la categoría del place', async () => {
    let categoryId: string
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rows } = await client.query<{ userId: string }>(
          `SELECT "userId" FROM "LibraryCategoryContributor" WHERE "categoryId" = $1`,
          [categoryId],
        )
        expect(rows).toHaveLength(1)
        expect(rows[0]?.userId).toBe(userIds.memberB)
      },
      {
        setup: async (client) => {
          categoryId = await insertTestLibraryCategory(client, {
            placeId: palermoId,
            contributionPolicy: 'DESIGNATED',
          })
          await insertTestLibraryContributor(client, {
            categoryId,
            userId: userIds.memberB,
            invitedByUserId: userIds.admin,
          })
        },
      },
    )
  })

  it('13. SELECT contributor: nonMember NO ve la lista', async () => {
    let categoryId: string
    await withUser(
      userIds.nonMember,
      async (client) => {
        const { rows } = await client.query<{ userId: string }>(
          `SELECT "userId" FROM "LibraryCategoryContributor" WHERE "categoryId" = $1`,
          [categoryId],
        )
        expect(rows).toHaveLength(0)
      },
      {
        setup: async (client) => {
          categoryId = await insertTestLibraryCategory(client, {
            placeId: palermoId,
            contributionPolicy: 'DESIGNATED',
          })
          await insertTestLibraryContributor(client, {
            categoryId,
            userId: userIds.memberB,
            invitedByUserId: userIds.admin,
          })
        },
      },
    )
  })

  it('14. INSERT contributor: admin invita OK', async () => {
    let categoryId: string
    await withUser(
      userIds.admin,
      async (client) => {
        const r = await client.query(
          `INSERT INTO "LibraryCategoryContributor"
            ("categoryId", "userId", "invitedByUserId", "invitedAt")
           VALUES ($1, $2, $3, NOW())
           RETURNING "categoryId"`,
          [categoryId, userIds.memberB, userIds.admin],
        )
        expect(r.rows).toHaveLength(1)
      },
      {
        setup: async (client) => {
          categoryId = await insertTestLibraryCategory(client, {
            placeId: palermoId,
            contributionPolicy: 'DESIGNATED',
          })
        },
      },
    )
  })

  it('15. INSERT contributor: memberA NO puede invitar', async () => {
    let categoryId: string
    await withUser(
      userIds.memberA,
      async (client) => {
        await expect(
          client.query(
            `INSERT INTO "LibraryCategoryContributor"
              ("categoryId", "userId", "invitedByUserId", "invitedAt")
             VALUES ($1, $2, $3, NOW())`,
            [categoryId, userIds.memberB, userIds.memberA],
          ),
        ).rejects.toThrow(/row-level security/i)
      },
      {
        setup: async (client) => {
          categoryId = await insertTestLibraryCategory(client, {
            placeId: palermoId,
            contributionPolicy: 'DESIGNATED',
          })
        },
      },
    )
  })

  it('16. DELETE contributor: admin desinvita OK', async () => {
    let categoryId: string
    await withUser(
      userIds.admin,
      async (client) => {
        const r = await client.query(
          `DELETE FROM "LibraryCategoryContributor"
           WHERE "categoryId" = $1 AND "userId" = $2`,
          [categoryId, userIds.memberB],
        )
        expect(r.rowCount).toBe(1)
      },
      {
        setup: async (client) => {
          categoryId = await insertTestLibraryCategory(client, {
            placeId: palermoId,
            contributionPolicy: 'DESIGNATED',
          })
          await insertTestLibraryContributor(client, {
            categoryId,
            userId: userIds.memberB,
            invitedByUserId: userIds.admin,
          })
        },
      },
    )
  })

  it('17. DELETE contributor: memberA NO puede desinvitar', async () => {
    let categoryId: string
    await withUser(
      userIds.memberA,
      async (client) => {
        const r = await client.query(
          `DELETE FROM "LibraryCategoryContributor"
           WHERE "categoryId" = $1 AND "userId" = $2`,
          [categoryId, userIds.memberB],
        )
        expect(r.rowCount).toBe(0)
      },
      {
        setup: async (client) => {
          categoryId = await insertTestLibraryCategory(client, {
            placeId: palermoId,
            contributionPolicy: 'DESIGNATED',
          })
          await insertTestLibraryContributor(client, {
            categoryId,
            userId: userIds.memberB,
            invitedByUserId: userIds.admin,
          })
        },
      },
    )
  })
})
