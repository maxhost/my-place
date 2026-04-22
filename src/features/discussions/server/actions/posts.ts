'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { assertPlaceOpenOrThrow } from '@/features/hours/public'
import { logger } from '@/shared/lib/logger'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'
import {
  createPostInputSchema,
  deletePostInputSchema,
  editPostInputSchema,
  hidePostInputSchema,
  openPostEditSessionInputSchema,
  unhidePostInputSchema,
} from '@/features/discussions/schemas'
import {
  buildAuthorSnapshot,
  canAdminHide,
  canDeleteContent,
  editWindowOpen,
} from '@/features/discussions/domain/invariants'
import { EditWindowExpired } from '@/features/discussions/domain/errors'
import { assertRichTextSize } from '@/features/discussions/domain/rich-text'
import {
  EDIT_SESSION_GRACE_MS,
  assertEditSessionToken,
  signEditSessionToken,
} from '@/shared/lib/edit-session-token'
import { RESERVED_POST_SLUGS, generatePostSlug } from '@/features/discussions/domain/slug'
import { resolveActorForPlace } from '../actor'
import { hardDeletePost } from '../hard-delete'

/**
 * Revalida las rutas afectadas por un cambio sobre un post específico.
 * Next.js cachea por path exacto, así que cada bucket (`/`, `/conversations`,
 * `/conversations/{slug}`) debe listarse explícitamente.
 */
function revalidatePostPaths(placeSlug: string, postSlug?: string): void {
  revalidatePath(`/${placeSlug}`)
  revalidatePath(`/${placeSlug}/conversations`)
  if (postSlug) revalidatePath(`/${placeSlug}/conversations/${postSlug}`)
}

/**
 * Resuelve un slug único dentro de un place. Lee las colisiones existentes que
 * empiezan con el mismo prefijo y construye el reserved set combinado. Sirve
 * tanto para el primer intento como para el reintento post-P2002.
 */
async function resolveUniqueSlug(placeId: string, title: string): Promise<string> {
  const base = generatePostSlug(title, { reserved: new Set() })
  const existing = await prisma.post.findMany({
    where: { placeId, slug: { startsWith: base } },
    select: { slug: true },
  })
  const reserved = new Set<string>([...RESERVED_POST_SLUGS, ...existing.map((e) => e.slug)])
  return generatePostSlug(title, { reserved })
}

/**
 * Crea un Post nuevo en un place. Gate por `assertPlaceOpenOrThrow` y membership
 * activa.
 *
 * Slug: derivado del título, único por `(placeId, slug)`. El UNIQUE index
 * protege contra races de doble-submit; ante P2002 reintentamos una vez con
 * las colisiones recalculadas. Segundo fallo ⇒ `ConflictError` (el user reintenta).
 */
export async function createPostAction(
  input: unknown,
): Promise<{ ok: true; postId: string; slug: string }> {
  const parsed = createPostInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para crear post.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const actor = await resolveActorForPlace({ placeId: data.placeId })
  await assertPlaceOpenOrThrow(actor.placeId)

  if (data.body) assertRichTextSize(data.body)

  const now = new Date()
  const trimmedTitle = data.title.trim()

  const attemptCreate = async (): Promise<{ id: string; slug: string }> => {
    const slug = await resolveUniqueSlug(actor.placeId, trimmedTitle)
    const created = await prisma.post.create({
      data: {
        placeId: actor.placeId,
        authorUserId: actor.actorId,
        authorSnapshot: buildAuthorSnapshot(actor.user) as Prisma.InputJsonValue,
        title: trimmedTitle,
        slug,
        body: data.body ? (data.body as Prisma.InputJsonValue) : Prisma.JsonNull,
        lastActivityAt: now,
      },
      select: { id: true, slug: true },
    })
    return created
  }

  let created: { id: string; slug: string }
  try {
    created = await attemptCreate()
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      try {
        created = await attemptCreate()
      } catch (retryErr) {
        if (retryErr instanceof Prisma.PrismaClientKnownRequestError && retryErr.code === 'P2002') {
          throw new ConflictError('No pudimos asignar una URL única. Probá con otro título.', {
            placeId: actor.placeId,
            title: trimmedTitle,
          })
        }
        throw retryErr
      }
    } else {
      throw err
    }
  }

  logger.info(
    {
      event: 'postCreated',
      placeId: actor.placeId,
      postId: created.id,
      postSlug: created.slug,
      actorId: actor.actorId,
    },
    'post created',
  )

  revalidatePostPaths(actor.placeSlug, created.slug)
  return { ok: true, postId: created.id, slug: created.slug }
}

/**
 * Edita título/body de un Post. Sólo el autor dentro de los primeros 60s.
 * Optimistic lock por `version` — si otro submit ganó la carrera, 409.
 */
export async function editPostAction(input: unknown): Promise<{ ok: true; version: number }> {
  const parsed = editPostInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para editar post.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const post = await prisma.post.findUnique({
    where: { id: data.postId },
    select: {
      id: true,
      placeId: true,
      authorUserId: true,
      slug: true,
      createdAt: true,
      hiddenAt: true,
    },
  })
  if (!post) throw new NotFoundError('Post no encontrado.', { postId: data.postId })

  const actor = await resolveActorForPlace({ placeId: post.placeId })
  await assertPlaceOpenOrThrow(actor.placeId)

  const now = new Date()

  // Admin bypassea la ventana y no necesita session token.
  // Autor: requiere token firmado al abrir el form. El token prueba que el
  // form se abrió cuando el server permitía editar (canEditPost al momento
  // del open). Eso permite que guarde aunque los 60s ya hayan pasado, siempre
  // que esté dentro del grace window (5min). Ver
  // `docs/decisions/2026-04-21-edit-session-token.md`.
  if (!actor.isAdmin) {
    if (!post.authorUserId || post.authorUserId !== actor.actorId) {
      throw new AuthorizationError('No podés editar este post.', {
        postId: post.id,
      })
    }
    if (!data.session) {
      // Sin token: sólo pasa si todavía estamos dentro de los 60s "clásicos"
      // (compat con callers viejos y fallback si el open falla).
      if (!editWindowOpen(post.createdAt, now)) {
        throw new EditWindowExpired({
          entityId: post.id,
          createdAt: post.createdAt,
          now,
          elapsedMs: now.getTime() - post.createdAt.getTime(),
        })
      }
    } else {
      // Con token: validamos firma + grace, y además chequeamos que al
      // `openedAt` la ventana estaba abierta — impide que un token viejo de
      // otro post se reuse o que un cliente fabrique un openedAt arbitrario.
      assertEditSessionToken(
        data.session.token,
        {
          subjectType: 'POST',
          subjectId: post.id,
          userId: actor.actorId,
          openedAt: data.session.openedAt,
        },
        now,
      )
      const openedAt = new Date(data.session.openedAt)
      if (!editWindowOpen(post.createdAt, openedAt)) {
        // Token firmado OK pero el openedAt cae fuera de los 60s — el form se
        // abrió después de vencida la ventana (no debería pasar vía UI, pero el
        // server no confía).
        throw new EditWindowExpired({
          entityId: post.id,
          createdAt: post.createdAt,
          now: openedAt,
          elapsedMs: openedAt.getTime() - post.createdAt.getTime(),
        })
      }
    }
  }

  if (data.body) assertRichTextSize(data.body)

  // Slug estable: edits al título dentro de los 60s NO regeneran la URL.
  const nextVersion = data.expectedVersion + 1
  const updated = await prisma.post.updateMany({
    where: { id: post.id, version: data.expectedVersion },
    data: {
      title: data.title.trim(),
      body: data.body ? (data.body as Prisma.InputJsonValue) : Prisma.JsonNull,
      editedAt: now,
      version: nextVersion,
    },
  })
  if (updated.count === 0) {
    throw new ConflictError('El post cambió desde que lo abriste.', {
      postId: post.id,
      expectedVersion: data.expectedVersion,
    })
  }

  logger.info(
    {
      event: 'postEdited',
      placeId: actor.placeId,
      postId: post.id,
      actorId: actor.actorId,
      actorRole: actor.isAdmin ? 'admin' : 'author',
      byAdmin: actor.isAdmin && post.authorUserId !== actor.actorId,
    },
    'post edited',
  )

  revalidatePostPaths(actor.placeSlug, post.slug)
  return { ok: true, version: nextVersion }
}

/**
 * Abre una sesión de edición de Post. Valida que el actor puede editar **ahora**
 * (autor dentro de 60s o admin) y devuelve un token HMAC firmado. El cliente
 * guarda el token y lo envía en `editPostAction`. Admins no reciben token: su
 * permiso no expira y `editPostAction` los deja pasar sin session.
 *
 * Rationale: el form puede demorar más de 60s en guardarse (user tipea). Sin
 * token, submit post-60s rebota aunque el user haya abierto en tiempo. Con
 * token, el server confía que la ventana estaba abierta al `openedAt` y
 * permite el guardado dentro del grace (5min).
 *
 * Ver `docs/decisions/2026-04-21-edit-session-token.md`.
 */
export async function openPostEditSession(
  input: unknown,
): Promise<
  | { ok: true; session: { token: string; openedAt: string; graceMs: number } }
  | { ok: true; adminBypass: true }
> {
  const parsed = openPostEditSessionInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  const data = parsed.data

  const post = await prisma.post.findUnique({
    where: { id: data.postId },
    select: {
      id: true,
      placeId: true,
      authorUserId: true,
      createdAt: true,
    },
  })
  if (!post) throw new NotFoundError('Post no encontrado.', { postId: data.postId })

  const actor = await resolveActorForPlace({ placeId: post.placeId })

  if (actor.isAdmin) {
    return { ok: true, adminBypass: true }
  }
  if (!post.authorUserId || post.authorUserId !== actor.actorId) {
    throw new AuthorizationError('No podés editar este post.', {
      postId: post.id,
    })
  }

  const now = new Date()
  if (!editWindowOpen(post.createdAt, now)) {
    throw new EditWindowExpired({
      entityId: post.id,
      createdAt: post.createdAt,
      now,
      elapsedMs: now.getTime() - post.createdAt.getTime(),
    })
  }

  const openedAt = now.toISOString()
  const token = signEditSessionToken({
    subjectType: 'POST',
    subjectId: post.id,
    userId: actor.actorId,
    openedAt,
  })
  return {
    ok: true,
    session: { token, openedAt, graceMs: EDIT_SESSION_GRACE_MS },
  }
}

/**
 * Admin oculta un Post (reversible). No lo borra; `hiddenAt` sólo se muestra
 * a admins con marca. Optimistic lock protege contra doble click.
 */
export async function hidePostAction(input: unknown): Promise<{ ok: true; version: number }> {
  const parsed = hidePostInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  return togglePostHidden(parsed.data, 'hide')
}

export async function unhidePostAction(input: unknown): Promise<{ ok: true; version: number }> {
  const parsed = unhidePostInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  return togglePostHidden(parsed.data, 'unhide')
}

async function togglePostHidden(
  data: { postId: string; expectedVersion: number },
  mode: 'hide' | 'unhide',
): Promise<{ ok: true; version: number }> {
  const post = await prisma.post.findUnique({
    where: { id: data.postId },
    select: { id: true, placeId: true, slug: true },
  })
  if (!post) {
    throw new NotFoundError('Post no encontrado.', { postId: data.postId })
  }

  const actor = await resolveActorForPlace({ placeId: post.placeId })
  if (!canAdminHide(actor)) {
    throw new AuthorizationError('Sólo admins pueden ocultar/revelar posts.', {
      postId: post.id,
    })
  }

  const nextVersion = data.expectedVersion + 1
  const updated = await prisma.post.updateMany({
    where: { id: post.id, version: data.expectedVersion },
    data: { hiddenAt: mode === 'hide' ? new Date() : null, version: nextVersion },
  })
  if (updated.count === 0) {
    throw new ConflictError('El post cambió desde que lo abriste.', {
      postId: post.id,
      expectedVersion: data.expectedVersion,
    })
  }

  logger.info(
    {
      event: mode === 'hide' ? 'postHidden' : 'postUnhidden',
      placeId: actor.placeId,
      postId: post.id,
      actorId: actor.actorId,
    },
    mode === 'hide' ? 'post hidden' : 'post unhidden',
  )

  revalidatePostPaths(actor.placeSlug, post.slug)
  return { ok: true, version: nextVersion }
}

/**
 * Borra un Post (hard delete). Autor puede en los primeros 60s; admin siempre.
 *
 * La fila desaparece y con ella cascade los `Comment` y `PostRead` (FK CASCADE
 * post C.G.1). `Reaction` y `Flag` son polimórficos (no tienen FK a Post), así
 * que se limpian a mano dentro de la misma tx — tanto los del post como los de
 * sus comments. Orden:
 *   1. Cargar ids de comments del post (para limpiar reactions/flags hijos).
 *   2. `reaction.deleteMany` sobre POST + sus COMMENTs.
 *   3. `flag.deleteMany` sobre POST + sus COMMENTs.
 *   4. `post.delete` — el CASCADE del FK mata comments y postReads.
 *
 * Irreversible. No hay "post borrado" como estado en el dominio post-C.G.1.
 */
export async function deletePostAction(input: unknown): Promise<{ ok: true }> {
  const parsed = deletePostInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos.', { issues: parsed.error.issues })
  }
  const data = parsed.data

  const post = await prisma.post.findUnique({
    where: { id: data.postId },
    select: {
      id: true,
      placeId: true,
      authorUserId: true,
      slug: true,
      createdAt: true,
      version: true,
    },
  })
  if (!post) {
    throw new NotFoundError('Post no encontrado.', { postId: data.postId })
  }

  const actor = await resolveActorForPlace({ placeId: post.placeId })
  const now = new Date()
  if (!canDeleteContent(actor, post.authorUserId, post.createdAt, now)) {
    if (
      !actor.isAdmin &&
      post.authorUserId === actor.actorId &&
      !editWindowOpen(post.createdAt, now)
    ) {
      throw new EditWindowExpired({
        entityId: post.id,
        createdAt: post.createdAt,
        now,
        elapsedMs: now.getTime() - post.createdAt.getTime(),
      })
    }
    throw new AuthorizationError('No podés borrar este post.', {
      postId: post.id,
    })
  }
  if (post.version !== data.expectedVersion) {
    throw new ConflictError('El post cambió desde que lo abriste.', {
      postId: post.id,
      expectedVersion: data.expectedVersion,
    })
  }

  await hardDeletePost(post.id)

  logger.info(
    {
      event: 'postDeleted',
      placeId: actor.placeId,
      postId: post.id,
      actorId: actor.actorId,
      actorRole: actor.isAdmin ? 'admin' : 'author',
      byAdmin: actor.isAdmin && post.authorUserId !== actor.actorId,
    },
    'post deleted (hard)',
  )

  revalidatePostPaths(actor.placeSlug, post.slug)
  return { ok: true }
}
