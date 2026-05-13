/**
 * API pública client-safe del sub-slice `library/contribution` (S1a, 2026-05-12).
 *
 * Write access scopes para categorías de la library — controla quién puede
 * CREAR items en cada categoría. Simétrico al sub-slice `library/access`
 * que controla read scope.
 *
 * El sub-slice agrega:
 * - Helper `canWriteCategory` (función pura, server + client safe).
 * - Server action `setLibraryCategoryWriteScopeAction` (override completo).
 * - Schema Zod del input del action.
 *
 * Boundary: este sub-slice puede importar de `@/features/library/public`
 * (parent). NO puede importar `@/features/library/access/*` directo
 * (sibling internals — usar `@/features/library/access/public`).
 *
 * Decisión: docs/decisions/2026-05-12-library-permissions-model.md
 */

// ---------------------------------------------------------------
// Domain — permisos puros (server + client safe)
// ---------------------------------------------------------------

export { canWriteCategory, type CategoryWriteContext } from './domain/permissions'

// ---------------------------------------------------------------
// Schemas Zod — input del action
// ---------------------------------------------------------------

export {
  setLibraryCategoryWriteScopeInputSchema,
  type SetLibraryCategoryWriteScopeInput,
} from './schemas'

// ---------------------------------------------------------------
// Server actions — referencias `'use server'` viajan client-safe
// ---------------------------------------------------------------

export {
  setLibraryCategoryWriteScopeAction,
  type SetLibraryCategoryWriteScopeResult,
} from './server/actions/set-write-scope'
