import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PoolClient } from 'pg'
import {
  closePool,
  insertTestOpening,
  insertTestPost,
  resolveE2EUserIds,
  withUser,
} from './harness'
import { E2E_PLACES, type E2ERole } from '../fixtures/e2e-data'

const palermoId = E2E_PLACES.palermo.id
const belgranoId = E2E_PLACES.belgrano.id

async function rlsInsertPostRead(
  client: PoolClient,
  opts: { postId: string; userId: string; openingId: string; id?: string },
): Promise<string> {
  const id = opts.id ?? `pr_rls_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  await client.query(
    `INSERT INTO "PostRead" (id, "postId", "userId", "placeOpeningId", "readAt", "dwellMs")
     VALUES ($1, $2, $3, $4, NOW(), 1000)`,
    [id, opts.postId, opts.userId, opts.openingId],
  )
  return id
}

describe('RLS: PostRead (7 casos)', () => {
  let userIds: Record<E2ERole, string>

  beforeAll(async () => {
    userIds = await resolveE2EUserIds()
  })

  afterAll(async () => {
    await closePool()
  })

  // ── INSERT (3) ────────────────────────────────────────────────────────

  it('INSERT: memberA registra su propia lectura → OK', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rowCount } = await client.query(
          `INSERT INTO "PostRead" (id, "postId", "userId", "placeOpeningId", "readAt", "dwellMs")
           VALUES ($1, $2, $3, $4, NOW(), 2000)`,
          ['pr_rls_insert_ok', 'post_rls_pr_ok', userIds.memberA, 'opening_rls_pr_ok'],
        )
        expect(rowCount).toBe(1)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_pr_ok',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-pr-ok',
          })
          await insertTestOpening(client, {
            id: 'opening_rls_pr_ok',
            placeId: palermoId,
          })
        },
      },
    )
  })

  it('INSERT: memberA con userId ajeno → rejected', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        await expect(
          client.query(
            `INSERT INTO "PostRead" (id, "postId", "userId", "placeOpeningId", "readAt", "dwellMs")
             VALUES ($1, $2, $3, $4, NOW(), 1000)`,
            ['pr_rls_imp', 'post_rls_pr_imp', userIds.memberB, 'opening_rls_pr_imp'],
          ),
        ).rejects.toThrow(/row-level security/i)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_pr_imp',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-pr-imp',
          })
          await insertTestOpening(client, {
            id: 'opening_rls_pr_imp',
            placeId: palermoId,
          })
        },
      },
    )
  })

  it('INSERT: non-member → rejected (Post no es de su place)', async () => {
    await withUser(
      userIds.nonMember,
      async (client) => {
        await expect(
          client.query(
            `INSERT INTO "PostRead" (id, "postId", "userId", "placeOpeningId", "readAt", "dwellMs")
             VALUES ($1, $2, $3, $4, NOW(), 1000)`,
            ['pr_rls_nm', 'post_rls_pr_nm', userIds.nonMember, 'opening_rls_pr_nm'],
          ),
        ).rejects.toThrow(/row-level security/i)
      },
      {
        setup: async (client) => {
          await insertTestPost(client, {
            id: 'post_rls_pr_nm',
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-pr-nm',
          })
          await insertTestOpening(client, {
            id: 'opening_rls_pr_nm',
            placeId: palermoId,
          })
        },
      },
    )
  })

  // ── SELECT (3) ────────────────────────────────────────────────────────

  it('SELECT: self ve sus propias filas', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "PostRead" WHERE id = $1`,
          ['pr_rls_select_self'],
        )
        expect(rows).toHaveLength(1)
      },
      {
        setup: async (client) => {
          const postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-pr-self',
          })
          const openingId = await insertTestOpening(client, { placeId: palermoId })
          await rlsInsertPostRead(client, {
            id: 'pr_rls_select_self',
            postId,
            userId: userIds.memberA,
            openingId,
          })
        },
      },
    )
  })

  it('SELECT: memberA ve filas de OTROS en posts de su place (via Post.placeId)', async () => {
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "PostRead" WHERE id = $1`,
          ['pr_rls_select_peer'],
        )
        expect(rows).toHaveLength(1)
      },
      {
        setup: async (client) => {
          const postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-pr-peer',
          })
          const openingId = await insertTestOpening(client, { placeId: palermoId })
          await rlsInsertPostRead(client, {
            id: 'pr_rls_select_peer',
            postId,
            userId: userIds.admin,
            openingId,
          })
        },
      },
    )
  })

  it('SELECT: non-member NO ve ninguna fila', async () => {
    await withUser(
      userIds.nonMember,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "PostRead" WHERE id = $1`,
          ['pr_rls_select_nm'],
        )
        expect(rows).toHaveLength(0)
      },
      {
        setup: async (client) => {
          const postId = await insertTestPost(client, {
            placeId: palermoId,
            authorUserId: userIds.memberA,
            slug: 'rls-pr-nm-select',
          })
          const openingId = await insertTestOpening(client, { placeId: palermoId })
          await rlsInsertPostRead(client, {
            id: 'pr_rls_select_nm',
            postId,
            userId: userIds.memberA,
            openingId,
          })
        },
      },
    )
  })

  it('SELECT: cross-place isolation — memberA de Palermo NO ve reads de Belgrano', async () => {
    // Confirma el invariante crítico del bloque "Leyeron": un miembro activo de
    // un place nunca puede ver lectores de otro place aunque conozca postId y
    // opening. La policy `is_active_member(placeId)` es la que bloquea.
    // memberA está sólo en Palermo (por fixtures); memberB está en Belgrano.
    await withUser(
      userIds.memberA,
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM "PostRead" WHERE id = $1`,
          ['pr_rls_cross_place'],
        )
        expect(rows).toHaveLength(0)
      },
      {
        setup: async (client) => {
          // Post + opening en Belgrano (place distinto al de memberA)
          const postId = await insertTestPost(client, {
            placeId: belgranoId,
            authorUserId: userIds.memberB,
            slug: 'rls-pr-cross-place',
          })
          const openingId = await insertTestOpening(client, { placeId: belgranoId })
          await rlsInsertPostRead(client, {
            id: 'pr_rls_cross_place',
            postId,
            userId: userIds.memberB,
            openingId,
          })
        },
      },
    )
  })
})
