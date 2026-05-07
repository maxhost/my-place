'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { requireAuthUserId } from '@/shared/lib/auth-user'
import { logger } from '@/shared/lib/logger'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'
import { ADMIN_PRESET_NAME, presetPermissions } from '@/features/groups/public'
import { revalidateMemberPermissions } from '@/features/members/public.server'
import { revalidateMyPlacesCache, revalidatePlaceCache } from './cache'
import {
  createPlaceSchema,
  transferOwnershipSchema,
  type CreatePlaceInput,
  type TransferOwnershipInput,
} from '../schemas'
import { assertMinOneOwner, assertSlugFormat, assertSlugNotReserved } from '../domain/invariants'
import { findPlaceBySlug, findPlaceOwnership } from './queries'

/**
 * Crea un place + PlaceOwnership + Membership + PermissionGroup preset
 * + GroupMembership del creador al preset, todo en una transacción.
 * El preset hereda `permissions: PERMISSIONS_ALL` y queda como entry-point
 * de admin del place. Ver `docs/features/places/spec.md` § "Crear un place".
 */
export async function createPlaceAction(
  input: unknown,
): Promise<{ ok: true; place: { id: string; slug: string } }> {
  const data = parseCreatePlaceInput(input)
  const actorId = await requireAuthUserId('Necesitás iniciar sesión para crear un place.')

  const existing = await findPlaceBySlug(data.slug)
  if (existing) throw new ConflictError('Ese slug ya está en uso.', { slug: data.slug })

  try {
    const place = await prisma.$transaction((tx) => createPlaceTx(tx, data, actorId))
    logger.info(
      {
        event: 'placeCreated',
        placeId: place.id,
        slug: place.slug,
        actorId,
        billingMode: data.billingMode,
      },
      'place created',
    )
    revalidatePath('/inbox')
    // Plan #2.3: el creator queda como owner+admin+member en el place recién
    // creado. Inicializamos el tag por las dudas (no debería haber cache
    // previo, pero garantiza limpieza si el tag quedó de un place homónimo
    // pasado por algún edge case).
    revalidateMemberPermissions(actorId, place.id)
    // Sesión 5.2: el creator suma este place a su lista — invalidar
    // `listMyPlaces(actorId)` para que la próxima carga del inbox lo
    // refleje sin esperar al floor de 60s.
    revalidateMyPlacesCache(actorId)
    return { ok: true, place }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('Ese slug ya está en uso.', { slug: data.slug })
    }
    logger.error({ err, actorId, slug: data.slug }, 'createPlaceAction failed')
    throw err
  }
}

function parseCreatePlaceInput(input: unknown): CreatePlaceInput {
  const parsed = createPlaceSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para crear el place.', {
      issues: parsed.error.issues,
    })
  }
  const data: CreatePlaceInput = parsed.data
  assertSlugFormat(data.slug)
  assertSlugNotReserved(data.slug)
  return data
}

/**
 * Tx del create: cinco inserts atómicos (place + ownership + membership +
 * preset PermissionGroup + group membership del creador al preset). El
 * preset es el entry-point de admin: cualquier asignación posterior de
 * "admin" pasa por agregar miembros a este grupo.
 *
 * El caller maneja P2002 fuera de la tx y mapea a `ConflictError` con
 * copy final de usuario.
 */
async function createPlaceTx(
  tx: Prisma.TransactionClient,
  data: CreatePlaceInput,
  actorId: string,
): Promise<{ id: string; slug: string }> {
  const created = await tx.place.create({
    data: {
      slug: data.slug,
      name: data.name,
      description: data.description ?? null,
      billingMode: data.billingMode,
    },
    select: { id: true, slug: true },
  })
  await tx.placeOwnership.create({ data: { userId: actorId, placeId: created.id } })
  await tx.membership.create({
    data: { userId: actorId, placeId: created.id },
  })
  const preset = await tx.permissionGroup.create({
    data: {
      placeId: created.id,
      name: ADMIN_PRESET_NAME,
      isPreset: true,
      permissions: presetPermissions(),
    },
    select: { id: true },
  })
  await tx.groupMembership.create({
    data: { userId: actorId, placeId: created.id, groupId: preset.id },
  })
  return created
}

/**
 * Archiva un place (soft delete). Solo el owner puede archivar.
 * Idempotente: si ya estaba archivado, retorna `alreadyArchived: true` sin error.
 */
export async function archivePlaceAction(
  placeId: string,
): Promise<{ ok: true; alreadyArchived: boolean }> {
  const actorId = await requireAuthUserId('Necesitás iniciar sesión para archivar un place.')

  const place = await prisma.place.findUnique({
    where: { id: placeId },
    select: { id: true, slug: true, archivedAt: true },
  })
  if (!place) {
    throw new NotFoundError('Place no encontrado.', { placeId })
  }

  const ownership = await findPlaceOwnership(actorId, placeId)
  if (!ownership) {
    throw new AuthorizationError('Solo el owner puede archivar un place.', { placeId, actorId })
  }

  if (place.archivedAt) {
    return { ok: true, alreadyArchived: true }
  }

  await prisma.place.update({
    where: { id: placeId },
    data: { archivedAt: new Date() },
  })

  logger.info({ event: 'placeArchived', placeId, actorId }, 'place archived')
  revalidatePath('/inbox')
  // Sesión 5.1: el archive cambia el shape del place cacheado
  // (`archivedAt`); invalidar el cache cross-request para que loaders
  // posteriores lo vean archivado sin esperar 60s.
  revalidatePlaceCache(place.slug, place.id)
  // Sesión 5.2: cuando `listMyPlaces(userId)` se invoca con
  // `includeArchived: false` (default), el place desaparece de la lista
  // de cada miembro. Cap dominio = 150; loop barato.
  const activeMembers = await prisma.membership.findMany({
    where: { placeId: place.id, leftAt: null },
    select: { userId: true },
  })
  for (const m of activeMembers) revalidateMyPlacesCache(m.userId)
  return { ok: true, alreadyArchived: false }
}

/**
 * Transfiere `PlaceOwnership` del actor al `toUserId`. Requiere que:
 * - El actor sea owner del place.
 * - El place esté activo.
 * - El target sea miembro **activo** de ESTE place (multi-place ortogonal: su estado en
 *   otros places es irrelevante).
 * - El target no sea el mismo actor.
 *
 * Si `removeActor = true`, además saca al actor de la ownership Y setea `leftAt` en su
 * membership (sale del place). Si `removeActor = false`, deja una co-ownership con el target.
 *
 * Concurrencia: `SELECT ... FOR UPDATE` sobre `PlaceOwnership` del place adentro de la tx —
 * serializa este action con `leaveMembershipAction` y con otros transfers concurrentes.
 * Ver `docs/features/members/spec.md` § "Transferir ownership".
 */
export async function transferOwnershipAction(
  input: unknown,
): Promise<{ ok: true; placeSlug: string; actorRemoved: boolean }> {
  const parsed = transferOwnershipSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para transferir ownership.', {
      issues: parsed.error.issues,
    })
  }
  const data: TransferOwnershipInput = parsed.data
  const { actorId, place } = await validateTransferPreconditions(data)

  try {
    await performTransferTx(actorId, place.id, data.toUserId, data.removeActor)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('Conflicto al transferir ownership.', {
        reason: 'ownership_conflict',
        placeId: place.id,
      })
    }
    throw err
  }

  logger.info(
    {
      event: 'ownershipTransferred',
      placeId: place.id,
      fromUserId: actorId,
      toUserId: data.toUserId,
      removeActor: data.removeActor,
    },
    'ownership transferred',
  )

  revalidatePath(`/${place.slug}/settings/members`)
  revalidatePath('/inbox')

  // Plan #2.3: la transferencia muta `PlaceOwnership` para AMBOS lados
  // (actor pierde owner si removeActor=true; target gana owner). Los perms
  // cambian para los dos — invalidar tags de ambos.
  revalidateMemberPermissions(actorId, place.id)
  revalidateMemberPermissions(data.toUserId, place.id)
  // Sesión 5.2: el campo `isOwner` de `listMyPlaces` cambia para ambos
  // (target pasa a true; actor a false si removeActor=true). Si
  // removeActor=true, además su membership se setea `leftAt` y el place
  // desaparece de su listing.
  revalidateMyPlacesCache(actorId)
  revalidateMyPlacesCache(data.toUserId)

  return { ok: true, placeSlug: place.slug, actorRemoved: data.removeActor }
}

/**
 * Resuelve y valida todo el estado pre-tx: auth del actor, no-self-transfer,
 * place activo, actor es owner. Throws typed errors — el caller propaga.
 */
async function validateTransferPreconditions(
  data: TransferOwnershipInput,
): Promise<{ actorId: string; place: { id: string; slug: string; archivedAt: Date | null } }> {
  const actorId = await requireAuthUserId('Necesitás iniciar sesión para transferir ownership.')

  if (data.toUserId === actorId) {
    throw new ValidationError('No tiene sentido transferirte la ownership a vos mismo.', {
      reason: 'self_transfer',
    })
  }

  const place = await findPlaceBySlug(data.placeSlug)
  if (!place) throw new NotFoundError('Place no encontrado.', { slug: data.placeSlug })
  if (place.archivedAt) {
    throw new ConflictError('Este place está archivado.', { archivedAt: place.archivedAt })
  }

  const actorOwnership = await findPlaceOwnership(actorId, place.id)
  if (!actorOwnership) {
    throw new AuthorizationError('Solo un owner puede transferir ownership.', {
      placeId: place.id,
      actorId,
    })
  }

  return { actorId, place }
}

/**
 * Tx del transfer: lock pesimista sobre `PlaceOwnership`, validación de
 * membership activa del target, upsert de ownership del target, y opcional
 * remove del actor (delete ownership + update leftAt de membership).
 * Guard `assertMinOneOwner` al final preserva el invariante del dominio.
 */
async function performTransferTx(
  actorId: string,
  placeId: string,
  toUserId: string,
  removeActor: boolean,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PlaceOwnership" WHERE "placeId" = ${placeId} FOR UPDATE`

    const targetMembership = await tx.membership.findFirst({
      where: { userId: toUserId, placeId, leftAt: null },
      select: { id: true },
    })
    if (!targetMembership) {
      throw new ValidationError('El destinatario no es miembro activo de este place.', {
        reason: 'target_not_member',
        toUserId,
        placeId,
      })
    }

    // Upsert idempotente: si ya era owner, el @@unique lo detecta y no duplica.
    await tx.placeOwnership.upsert({
      where: { userId_placeId: { userId: toUserId, placeId } },
      create: { userId: toUserId, placeId },
      update: {},
    })

    if (removeActor) {
      await tx.placeOwnership.delete({
        where: { userId_placeId: { userId: actorId, placeId } },
      })
      await tx.membership.updateMany({
        where: { userId: actorId, placeId, leftAt: null },
        data: { leftAt: new Date() },
      })
    }

    const countAfter = await tx.placeOwnership.count({ where: { placeId } })
    assertMinOneOwner(countAfter, { placeId })
  })
}
