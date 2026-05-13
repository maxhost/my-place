/**
 * Permisos del sub-slice `library/contribution` — funciones puras.
 *
 * Define `canWriteCategory`: gate de ESCRITURA (creación de items) en una
 * categoría. Simétrico a `canReadCategory` del sub-slice
 * `library/access` — el ADR `2026-05-12-library-permissions-model.md`
 * estableció dos dimensiones independientes (read + write) con 4
 * opciones cada una.
 *
 * Regla canónica:
 *  - Owner SIEMPRE escribe (decisión user 2026-05-12 — owner-bypass first).
 *  - `writeAccessKind === 'OWNER_ONLY'` → sólo owner. Default restrictivo.
 *  - `writeAccessKind === 'GROUPS'` → matching `viewer.groupIds` ∩ `groupWriteIds`.
 *  - `writeAccessKind === 'TIERS'`  → matching `viewer.tierIds` ∩ `tierWriteIds`.
 *  - `writeAccessKind === 'USERS'`  → `viewer.userId` ∈ `userWriteIds`.
 *
 * **Write implica read**: si `canWriteCategory()` es true, el viewer
 * también puede leer la categoría — esa derivación NO vive acá (vive en
 * el page composer que combina ambos helpers). El gate de read sigue
 * usando `canReadCategory` del sub-slice `library/access`.
 *
 * Ver `docs/decisions/2026-05-12-library-permissions-model.md`.
 */

import type { LibraryViewer, WriteAccessKind } from '@/features/library/public'

/**
 * Contexto de escritura de una categoría — datos necesarios para evaluar
 * `canWriteCategory`. Lo provee `findWriteScope(categoryId)` (queries del
 * sub-slice) más el `writeAccessKind` que vive en `LibraryCategory`.
 *
 * Cuando `writeAccessKind === 'OWNER_ONLY'` los 3 arrays se ignoran
 * (pueden estar vacíos sin afectar el resultado — sólo owner pasa).
 */
export type CategoryWriteContext = {
  writeAccessKind: WriteAccessKind
  /** IDs de `PermissionGroup` con write scope. Aplica sólo si kind=GROUPS. */
  groupWriteIds: ReadonlyArray<string>
  /** IDs de `Tier` con write scope. Aplica sólo si kind=TIERS. */
  tierWriteIds: ReadonlyArray<string>
  /** IDs de `User` con write scope. Aplica sólo si kind=USERS. */
  userWriteIds: ReadonlyArray<string>
}

/**
 * ¿Puede el viewer crear/escribir items en esta categoría?
 *
 * - Owner: siempre (decisión user 2026-05-12, owner-bypass first).
 * - OWNER_ONLY: sólo owner (default cerrado).
 * - GROUPS: matching de `viewer.groupIds` con `groupWriteIds`.
 * - TIERS: idem con `tierIds`/`tierWriteIds`.
 * - USERS: `viewer.userId` ∈ `userWriteIds`.
 *
 * Replica el shape del `canReadCategory` para simetría — el wizard de
 * categoría usará ambos en paralelo.
 */
export function canWriteCategory(category: CategoryWriteContext, viewer: LibraryViewer): boolean {
  if (viewer.isOwner) return true
  switch (category.writeAccessKind) {
    case 'OWNER_ONLY':
      return false
    case 'GROUPS':
      return viewer.groupIds.some((g) => category.groupWriteIds.includes(g))
    case 'TIERS':
      return viewer.tierIds.some((t) => category.tierWriteIds.includes(t))
    case 'USERS':
      return category.userWriteIds.includes(viewer.userId)
    default: {
      const _exhaustive: never = category.writeAccessKind
      return _exhaustive
    }
  }
}
