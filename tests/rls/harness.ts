/**
 * Harness para tests directos de Row Level Security.
 *
 * Mecanismo:
 *   1. Conexión `pg.Pool` sobre `DIRECT_URL` (session mode, puerto 5432 del
 *      pooler). `SET LOCAL request.jwt.claims` NO persiste en transaction
 *      pooler (puerto 6543) — por eso NUNCA usar `DATABASE_URL` acá.
 *   2. Cada caso abre una tx, opcionalmente seedea data con privilegios de
 *      `postgres` (bypassea RLS), luego hace:
 *         SET LOCAL ROLE authenticated
 *         SET LOCAL request.jwt.claims = '{"sub":<userId>,"role":"authenticated"}'
 *      A partir de ese punto, las queries se ejecutan bajo RLS como ese user.
 *   3. `ROLLBACK` garantiza que ninguna escritura del test persiste — el único
 *      efecto de una corrida son los rows que la seed dejó (pre-existentes).
 *
 * Interpretación de "JWT alterno" del roadmap: setear el claim directo, no
 * mintar JWTs firmados. `auth.uid()` lee `request.jwt.claims->>'sub'` sin
 * verificar firma — es el patrón oficial Supabase para testing de RLS.
 *
 * Los user IDs son UUIDs que Supabase crea al primer seed. El harness los
 * resuelve via `SELECT id FROM "User" WHERE email = $1` en `beforeAll`.
 */

import { Pool, type PoolClient } from 'pg'
import { E2E_EMAILS, type E2ERole } from '../fixtures/e2e-data'

const DIRECT_URL = process.env.DIRECT_URL
if (!DIRECT_URL) {
  throw new Error('[rls/harness] Falta DIRECT_URL. Correr vía `pnpm test:rls` (carga .env.local).')
}

export const pool = new Pool({
  connectionString: DIRECT_URL,
  max: 4,
  idleTimeoutMillis: 10_000,
})

export async function closePool(): Promise<void> {
  await pool.end()
}

/**
 * Resuelve los UUIDs de los 6 users E2E leyendo `public."User"` por email.
 * Asume que `pnpm test:e2e:seed` ya corrió.
 */
export async function resolveE2EUserIds(): Promise<Record<E2ERole, string>> {
  const emails = Object.values(E2E_EMAILS)
  const { rows } = await pool.query<{ id: string; email: string }>(
    'SELECT id, email FROM "User" WHERE email = ANY($1)',
    [emails],
  )
  const byEmail = new Map(rows.map((r) => [r.email, r.id]))
  const result = {} as Record<E2ERole, string>
  for (const [role, email] of Object.entries(E2E_EMAILS) as Array<[E2ERole, string]>) {
    const id = byEmail.get(email)
    if (!id) {
      throw new Error(
        `[rls/harness] User E2E no encontrado: ${email}. ¿Corriste \`pnpm test:e2e:seed\`?`,
      )
    }
    result[role] = id
  }
  return result
}

export interface WithUserOptions {
  /** Seed dentro de la tx con privilegios de `postgres` (bypass RLS). Opcional. */
  setup?: (client: PoolClient) => Promise<void>
  /** Rol Postgres a activar. Default: `authenticated`. `anon` para user no logueado. */
  role?: 'authenticated' | 'anon'
}

/**
 * Abre una tx, corre setup opcional como postgres super, luego cambia a rol
 * `authenticated` con claim `sub=userId`, y ejecuta `fn`. Rollback siempre.
 */
export async function withUser<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
  opts: WithUserOptions = {},
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (opts.setup) await opts.setup(client)
    await client.query(`SET LOCAL ROLE ${opts.role ?? 'authenticated'}`)
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: opts.role ?? 'authenticated' }),
    ])
    return await fn(client)
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
  }
}

/**
 * Variante sin user: abre tx, corre fn como `anon` sin claim (auth.uid() → null).
 * Útil para testear bloqueo a usuarios sin sesión.
 */
export async function withAnon<T>(
  fn: (client: PoolClient) => Promise<T>,
  opts: { setup?: (client: PoolClient) => Promise<void> } = {},
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (opts.setup) await opts.setup(client)
    await client.query(`SET LOCAL ROLE anon`)
    return await fn(client)
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
  }
}

/* ========================================================================
 * Helpers de inserción dentro de la tx. Corren ANTES de `SET LOCAL ROLE
 * authenticated` en la función setup → bypasean RLS (rol `postgres`).
 * Los IDs generados son ad-hoc (no cuid real) pero válidos para el schema
 * (columna TEXT). Todos se descartan en el ROLLBACK del `withUser`.
 * ==================================================================== */

function rlsId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export async function insertTestPost(
  client: PoolClient,
  opts: {
    placeId: string
    authorUserId: string | null
    slug?: string
    title?: string
    hiddenAt?: Date | null
    id?: string
  },
): Promise<string> {
  const id = opts.id ?? rlsId('post_rls')
  await client.query(
    `INSERT INTO "Post"
       (id, "placeId", "authorUserId", "authorSnapshot", title, slug, body,
        "createdAt", "lastActivityAt", "hiddenAt", version)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb,
             NOW(), NOW(), $8, 0)`,
    [
      id,
      opts.placeId,
      opts.authorUserId,
      JSON.stringify({ displayName: 'RLS', avatarUrl: null }),
      opts.title ?? 'RLS test post',
      opts.slug ?? id,
      JSON.stringify({ type: 'doc', content: [] }),
      opts.hiddenAt ?? null,
    ],
  )
  return id
}

export async function insertTestComment(
  client: PoolClient,
  opts: {
    postId: string
    placeId: string
    authorUserId: string | null
    body?: string
    deletedAt?: Date | null
    id?: string
  },
): Promise<string> {
  const id = opts.id ?? rlsId('comment_rls')
  await client.query(
    `INSERT INTO "Comment"
       (id, "postId", "placeId", "authorUserId", "authorSnapshot", body,
        "createdAt", "deletedAt", version)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW(), $7, 0)`,
    [
      id,
      opts.postId,
      opts.placeId,
      opts.authorUserId,
      JSON.stringify({ displayName: 'RLS', avatarUrl: null }),
      JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: opts.body ?? 'hi' }] }],
      }),
      opts.deletedAt ?? null,
    ],
  )
  return id
}

export async function insertTestReaction(
  client: PoolClient,
  opts: {
    targetType: 'POST' | 'COMMENT'
    targetId: string
    placeId: string
    userId: string
    emoji?: 'THUMBS_UP' | 'HEART' | 'LAUGH' | 'PRAY' | 'THINKING' | 'CRY'
    id?: string
  },
): Promise<string> {
  const id = opts.id ?? rlsId('reaction_rls')
  await client.query(
    `INSERT INTO "Reaction"
       (id, "targetType", "targetId", "placeId", "userId", emoji, "createdAt")
     VALUES ($1, $2::\"ContentTargetKind\", $3, $4, $5, $6::\"ReactionEmoji\", NOW())`,
    [id, opts.targetType, opts.targetId, opts.placeId, opts.userId, opts.emoji ?? 'HEART'],
  )
  return id
}

export async function insertTestFlag(
  client: PoolClient,
  opts: {
    targetType: 'POST' | 'COMMENT'
    targetId: string
    placeId: string
    reporterUserId: string
    reason?: 'SPAM' | 'HARASSMENT' | 'OFFTOPIC' | 'MISINFO' | 'OTHER'
    status?: 'OPEN' | 'REVIEWED_ACTIONED' | 'REVIEWED_DISMISSED'
    id?: string
  },
): Promise<string> {
  const id = opts.id ?? rlsId('flag_rls')
  await client.query(
    `INSERT INTO "Flag"
       (id, "targetType", "targetId", "placeId", "reporterUserId", reason, status, "createdAt")
     VALUES ($1, $2::\"ContentTargetKind\", $3, $4, $5, $6::\"FlagReason\", $7::\"FlagStatus\", NOW())`,
    [
      id,
      opts.targetType,
      opts.targetId,
      opts.placeId,
      opts.reporterUserId,
      opts.reason ?? 'SPAM',
      opts.status ?? 'OPEN',
    ],
  )
  return id
}

export async function insertTestOpening(
  client: PoolClient,
  opts: {
    placeId: string
    source?: 'SCHEDULED' | 'ALWAYS_OPEN' | 'EXCEPTION'
    id?: string
  },
): Promise<string> {
  const id = opts.id ?? rlsId('opening_rls')
  // El schema tiene un UNIQUE parcial `(placeId) WHERE endAt IS NULL` — máx 1
  // apertura activa por place. Cierro cualquier opening activa previa del place
  // (incluye la del seed) para poder insertar la nueva. El ROLLBACK de la tx
  // revierte ambos cambios, así que no se daña el estado persistente.
  await client.query(
    `UPDATE "PlaceOpening" SET "endAt" = NOW() WHERE "placeId" = $1 AND "endAt" IS NULL`,
    [opts.placeId],
  )
  await client.query(
    `INSERT INTO "PlaceOpening"
       (id, "placeId", "startAt", "source", "createdAt")
     VALUES ($1, $2, NOW(), $3::\"PlaceOpeningSource\", NOW())`,
    [id, opts.placeId, opts.source ?? 'ALWAYS_OPEN'],
  )
  return id
}

/* ========================================================================
 * Helpers para slice `events` (F.B Fase 6).
 * ==================================================================== */

export type RSVPStateValue = 'GOING' | 'GOING_CONDITIONAL' | 'NOT_GOING_CONTRIBUTING' | 'NOT_GOING'

export async function insertTestEvent(
  client: PoolClient,
  opts: {
    placeId: string
    authorUserId: string | null
    title?: string
    timezone?: string
    startsAt?: Date
    endsAt?: Date | null
    cancelledAt?: Date | null
    id?: string
  },
): Promise<string> {
  const id = opts.id ?? rlsId('event_rls')
  // Default startsAt una hora en el futuro para no chocar con invariant
  // del dominio si se ejecuta vía action (los tests RLS bypasean igual,
  // pero mantengo el default sensato).
  const startsAt = opts.startsAt ?? new Date(Date.now() + 60 * 60 * 1000)
  await client.query(
    `INSERT INTO "Event"
       (id, "placeId", "authorUserId", "authorSnapshot", title, "startsAt",
        "endsAt", timezone, "createdAt", "updatedAt", "cancelledAt")
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, NOW(), NOW(), $9)`,
    [
      id,
      opts.placeId,
      opts.authorUserId,
      JSON.stringify({ displayName: 'RLS', avatarUrl: null }),
      opts.title ?? 'RLS test event',
      startsAt,
      opts.endsAt ?? null,
      opts.timezone ?? 'America/Argentina/Buenos_Aires',
      opts.cancelledAt ?? null,
    ],
  )
  return id
}

export async function insertTestRsvp(
  client: PoolClient,
  opts: {
    eventId: string
    userId: string
    state?: RSVPStateValue
    note?: string | null
    id?: string
  },
): Promise<string> {
  const id = opts.id ?? rlsId('rsvp_rls')
  await client.query(
    `INSERT INTO "EventRSVP"
       (id, "eventId", "userId", state, note, "updatedAt")
     VALUES ($1, $2, $3, $4::\"RSVPState\", $5, NOW())`,
    [id, opts.eventId, opts.userId, opts.state ?? 'GOING', opts.note ?? null],
  )
  return id
}

/* ========================================================================
 * Helpers para slice `library` (R.7.1).
 * ==================================================================== */

export type ContributionPolicyValue = 'ADMIN_ONLY' | 'DESIGNATED' | 'MEMBERS_OPEN'

export async function insertTestLibraryCategory(
  client: PoolClient,
  opts: {
    placeId: string
    slug?: string
    title?: string
    emoji?: string
    contributionPolicy?: ContributionPolicyValue
    archivedAt?: Date | null
    position?: number | null
    id?: string
  },
): Promise<string> {
  const id = opts.id ?? rlsId('libcat_rls')
  // Slugs deben matchear /^[a-z0-9]+(-[a-z0-9]+)*$/ — el rlsId() incluye `_`,
  // así que normalizamos a guiones para satisfacer el CHECK constraint.
  const slug = opts.slug ?? id.replace(/_/g, '-')
  await client.query(
    `INSERT INTO "LibraryCategory"
       (id, "placeId", slug, emoji, title, "position", "contributionPolicy",
        "archivedAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7::"ContributionPolicy", $8, NOW(), NOW())`,
    [
      id,
      opts.placeId,
      slug,
      opts.emoji ?? '📚',
      opts.title ?? 'RLS test category',
      opts.position ?? null,
      opts.contributionPolicy ?? 'ADMIN_ONLY',
      opts.archivedAt ?? null,
    ],
  )
  return id
}

export async function insertTestLibraryContributor(
  client: PoolClient,
  opts: {
    categoryId: string
    userId: string
    invitedByUserId: string
  },
): Promise<void> {
  await client.query(
    `INSERT INTO "LibraryCategoryContributor"
       ("categoryId", "userId", "invitedByUserId", "invitedAt")
     VALUES ($1, $2, $3, NOW())`,
    [opts.categoryId, opts.userId, opts.invitedByUserId],
  )
}
