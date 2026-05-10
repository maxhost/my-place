'use server'

import { prisma } from '@/db/client'
import { AuthorizationError, NotFoundError, ValidationError } from '@/shared/errors/domain-error'
import { logger } from '@/shared/lib/logger'
import { resolveActorForPlace } from '@/features/discussions/public.server'
import { hasPermission } from '@/features/members/public.server'
import { archiveCategoryInputSchema } from '@/features/library/schemas'
import { revalidateLibraryCategoryPaths } from './shared'

/**
 * Archiva una categoría (soft-delete) seteando `archivedAt = now()`.
 *
 * R.7.2: solo afecta el flag de la categoría — los items asociados
 * (cuando R.7.5+ los sume) NO se cascadean. Decisión del spec § 11:
 * "Eliminar la categoría no destruye items: archive cascada con
 * archivedAt (mantenemos memoria del place)". El cascada de items
 * llega en R.7.6 (acción separada o flag en esta misma).
 *
 * Si la categoría ya está archivada, idempotente — no tira error,
 * loguea info y returna ok. Permite re-llamar sin race conditions.
 *
 * Restore (des-archivar) NO está cubierto en R.7.2 — se suma como
 * `restoreCategoryAction` cuando la UI admin lo necesite. Por ahora
 * un admin puede restaurar via DB o creando una nueva.
 */
export async function archiveLibraryCategoryAction(
  input: unknown,
): Promise<{ ok: true; categoryId: string; alreadyArchived: boolean }> {
  const parsed = archiveCategoryInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Datos inválidos para archivar categoría.', {
      issues: parsed.error.issues,
    })
  }
  const data = parsed.data

  const category = await prisma.libraryCategory.findUnique({
    where: { id: data.categoryId },
    select: { id: true, placeId: true, slug: true, archivedAt: true },
  })
  if (!category) {
    throw new NotFoundError('Categoría no encontrada.', { categoryId: data.categoryId })
  }

  const actor = await resolveActorForPlace({ placeId: category.placeId })
  // G.3 port (2026-05-09): owner + grupos con `library:moderate-categories`
  // (scoped por categoryId si el grupo tiene scope a categorías específicas).
  // Antes solo `actor.isAdmin`. Ver `docs/plans/2026-05-09-g3-debt-port-to-legacy.md` § A3.
  const allowed = await hasPermission(actor.actorId, actor.placeId, 'library:moderate-categories', {
    categoryId: category.id,
  })
  if (!allowed) {
    throw new AuthorizationError('No tenés permiso para archivar esta categoría.', {
      placeId: actor.placeId,
      categoryId: category.id,
      actorId: actor.actorId,
    })
  }

  if (category.archivedAt) {
    logger.info(
      {
        event: 'libraryCategoryArchiveSkipped',
        placeId: actor.placeId,
        categoryId: category.id,
        actorId: actor.actorId,
      },
      'category already archived; skipping',
    )
    return { ok: true, categoryId: category.id, alreadyArchived: true }
  }

  await prisma.libraryCategory.update({
    where: { id: category.id },
    data: { archivedAt: new Date() },
  })

  logger.info(
    {
      event: 'libraryCategoryArchived',
      placeId: actor.placeId,
      categoryId: category.id,
      slug: category.slug,
      actorId: actor.actorId,
    },
    'library category archived',
  )

  revalidateLibraryCategoryPaths(actor.placeSlug, category.slug, actor.placeId)
  return { ok: true, categoryId: category.id, alreadyArchived: false }
}
