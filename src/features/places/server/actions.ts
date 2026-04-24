'use server'

import { revalidatePath } from 'next/cache'
import { Prisma, MembershipRole } from '@prisma/client'
import { prisma } from '@/db/client'
import { createSupabaseServer } from '@/shared/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'
import {
  createPlaceSchema,
  transferOwnershipSchema,
  type CreatePlaceInput,
  type TransferOwnershipInput,
} from '../schemas'
import { assertMinOneOwner, assertSlugFormat, assertSlugNotReserved } from '../domain/invariants'
import { findPlaceBySlug, findPlaceOwnership } from './queries'

/**
 * Crea un place + PlaceOwnership + Membership(ADMIN) del creador en una transacción.
 * Ver `docs/features/places/spec.md` § "Crear un place".
 */
export async function createPlaceAction(
  input: unknown,
): Promise<{ ok: true; place: { id: string; slug: string } }> {
  const parsed = createPlaceSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para crear el place.', {
      issues: parsed.error.issues,
    })
  }
  const data: CreatePlaceInput = parsed.data

  assertSlugFormat(data.slug)
  assertSlugNotReserved(data.slug)

  const supabase = await createSupabaseServer()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) {
    throw new AuthorizationError('Necesitás iniciar sesión para crear un place.')
  }
  const actorId = auth.user.id

  const existing = await findPlaceBySlug(data.slug)
  if (existing) {
    throw new ConflictError('Ese slug ya está en uso.', { slug: data.slug })
  }

  try {
    const place = await prisma.$transaction(async (tx) => {
      const created = await tx.place.create({
        data: {
          slug: data.slug,
          name: data.name,
          description: data.description ?? null,
          billingMode: data.billingMode,
        },
        select: { id: true, slug: true },
      })

      await tx.placeOwnership.create({
        data: { userId: actorId, placeId: created.id },
      })

      await tx.membership.create({
        data: { userId: actorId, placeId: created.id, role: MembershipRole.ADMIN },
      })

      return created
    })

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
    return { ok: true, place }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('Ese slug ya está en uso.', { slug: data.slug })
    }
    logger.error({ err, actorId, slug: data.slug }, 'createPlaceAction failed')
    throw err
  }
}

/**
 * Archiva un place (soft delete). Solo el owner puede archivar.
 * Idempotente: si ya estaba archivado, retorna `alreadyArchived: true` sin error.
 */
export async function archivePlaceAction(
  placeId: string,
): Promise<{ ok: true; alreadyArchived: boolean }> {
  const supabase = await createSupabaseServer()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) {
    throw new AuthorizationError('Necesitás iniciar sesión para archivar un place.')
  }
  const actorId = auth.user.id

  const place = await prisma.place.findUnique({
    where: { id: placeId },
    select: { id: true, archivedAt: true },
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

  return { ok: true, placeSlug: place.slug, actorRemoved: data.removeActor }
}

/**
 * Resuelve y valida todo el estado pre-tx: auth del actor, no-self-transfer,
 * place activo, actor es owner. Throws typed errors — el caller propaga.
 */
async function validateTransferPreconditions(
  data: TransferOwnershipInput,
): Promise<{ actorId: string; place: { id: string; slug: string; archivedAt: Date | null } }> {
  const supabase = await createSupabaseServer()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) {
    throw new AuthorizationError('Necesitás iniciar sesión para transferir ownership.')
  }
  const actorId = auth.user.id

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
