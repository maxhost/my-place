/**
 * Permisos del slice `library` — funciones puras.
 *
 * Replican la matriz de § 11 de la spec. Se usan en:
 *   - Server actions (gate antes del INSERT/UPDATE).
 *   - UI condicional (botones visibles/ocultos según viewer).
 *   - Tests unit.
 *
 * La RLS (migration 20260430000000) replica la lógica a nivel SQL —
 * estas funciones son la fuente canónica del lado app.
 *
 * Ver `docs/features/library/spec.md` § 11.
 */

import type { ContributionPolicy } from './types'

/**
 * Viewer mínimo para evaluar permisos. Lo provee `resolveActorForPlace`
 * de discussions (ya carga membership + ownership).
 */
export type LibraryViewer = {
  userId: string
  isAdmin: boolean // membership ADMIN ∨ PlaceOwnership
}

export type CategoryForPermissions = {
  contributionPolicy: ContributionPolicy
  /** Lista de userIds designated. Se popula solo cuando policy=DESIGNATED;
   *  para otras policies el caller puede pasar [] sin importar. */
  designatedUserIds: ReadonlyArray<string>
}

/**
 * ¿Puede el viewer crear un item en esta categoría?
 *
 * - admin/owner: siempre
 * - policy=ADMIN_ONLY: solo admin
 * - policy=DESIGNATED: admin o miembro listado
 * - policy=MEMBERS_OPEN: cualquier miembro activo (asumido por el
 *   caller — la membership ya fue verificada por `resolveActorForPlace`)
 */
export function canCreateInCategory(
  category: CategoryForPermissions,
  viewer: LibraryViewer,
): boolean {
  if (viewer.isAdmin) return true
  switch (category.contributionPolicy) {
    case 'ADMIN_ONLY':
      return false
    case 'DESIGNATED':
      return category.designatedUserIds.includes(viewer.userId)
    case 'MEMBERS_OPEN':
      return true
  }
}

/**
 * ¿Puede el viewer editar/archivar la categoría?
 *
 * Solo admin/owner. Author no aplica (las categorías no tienen author —
 * son decisión del admin, decisión user 2026-04-30).
 */
export function canEditCategory(viewer: LibraryViewer): boolean {
  return viewer.isAdmin
}

/**
 * ¿Puede el viewer editar el item?
 *
 * R.7.6+: admin/owner o author del item (Post.authorUserId === viewer.userId).
 * En R.7.2 no hay items todavía — la función vive acá para preservar la
 * superficie pública del slice.
 */
export function canEditItem(item: { authorUserId: string | null }, viewer: LibraryViewer): boolean {
  if (viewer.isAdmin) return true
  return item.authorUserId === viewer.userId
}

/** Mismo modelo que `canEditItem`. */
export function canArchiveItem(
  item: { authorUserId: string | null },
  viewer: LibraryViewer,
): boolean {
  return canEditItem(item, viewer)
}
