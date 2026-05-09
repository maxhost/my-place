'use server'

import { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/shared/errors/domain-error'
import { logger } from '@/shared/lib/logger'
import { resolveActorForPlace } from '@/features/discussions/public.server'
import { inviteContributorInputSchema } from '@/features/library/schemas'
import { revalidateLibraryCategoryPaths } from './shared'

/**
 * Invita a un member del place como contributor designado de una categoría.
 *
 * Flow:
 *  1. Parse Zod del input.
 *  2. Resuelve la categoría (puede estar archivada — admin podría querer
 *     pre-poblar contributors antes de des-archivar; aceptamos).
 *  3. Resuelve el actor — debe ser admin/owner del place.
 *  4. Verifica que el `userId` invitado sea miembro activo del place.
 *  5. INSERT en `LibraryCategoryContributor`. Si ya está invitado,
 *     retorna `alreadyInvited: true` (idempotente). Postgres tira P2002
 *     en la PK compuesta — lo capturamos.
 *
 * La categoría puede tener cualquier policy — no exigimos
 * `DESIGNATED` acá. Si el admin invita y después cambia a
 * `DESIGNATED`, los contributors quedan inmediatamente activos.
 * Si la policy queda en `ADMIN_ONLY` o `MEMBERS_OPEN`, los rows
 * de contributors viven sin efecto pero sin daño.
 */
export async function inviteContributorAction(
  input: unknown,
): Promise<{ ok: true; alreadyInvited: boolean }> {
  const parsed = inviteContributorInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para invitar contribuidor.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const category = await prisma.libraryCategory.findUnique({
    where: { id: data.categoryId },
    select: { id: true, placeId: true, slug: true },
  })
  if (!category) {
    throw new NotFoundError('Categoría no encontrada.', { categoryId: data.categoryId })
  }

  const actor = await resolveActorForPlace({ placeId: category.placeId })
  if (!actor.isAdmin) {
    throw new AuthorizationError('Solo admin/owner pueden invitar contribuidores.', {
      placeId: actor.placeId,
      actorId: actor.actorId,
    })
  }

  const targetMembership = await prisma.membership.findUnique({
    where: { userId_placeId: { userId: data.userId, placeId: category.placeId } },
    select: { leftAt: true },
  })
  if (!targetMembership || targetMembership.leftAt !== null) {
    throw new ValidationError('La persona invitada no es miembro activo del place.', {
      userId: data.userId,
    })
  }

  try {
    await prisma.libraryCategoryContributor.create({
      data: {
        categoryId: category.id,
        userId: data.userId,
        invitedByUserId: actor.actorId,
      },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.info(
        {
          event: 'libraryContributorInviteSkipped',
          categoryId: category.id,
          invitedUserId: data.userId,
          actorId: actor.actorId,
        },
        'contributor already invited; idempotent skip',
      )
      revalidateLibraryCategoryPaths(actor.placeSlug, category.slug, actor.placeId)
      return { ok: true, alreadyInvited: true }
    }
    throw err
  }

  logger.info(
    {
      event: 'libraryContributorInvited',
      placeId: actor.placeId,
      categoryId: category.id,
      invitedUserId: data.userId,
      actorId: actor.actorId,
    },
    'library contributor invited',
  )

  revalidateLibraryCategoryPaths(actor.placeSlug, category.slug, actor.placeId)
  return { ok: true, alreadyInvited: false }
}

// Re-export ConflictError para que el caller pueda diferenciar idempotencia
// del verdadero error de race. Por ahora no lo usamos (idempotente sin
// surface) pero lo dejo declarado para evitar import warning futuro.
export type { ConflictError }
