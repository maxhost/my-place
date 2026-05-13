import 'server-only'

/**
 * API pública server-only del sub-slice `library/contribution` (S1a,
 * 2026-05-12).
 *
 * Queries Prisma + `findWriteScope(categoryId)` cacheable. Server
 * Components y pages importan de acá. Client Components importan sólo
 * de `@/features/library/contribution/public`.
 *
 * Razón del split: si un Client Component importa
 * `@/features/library/contribution/public` y este re-exporta queries
 * Prisma con `import 'server-only'`, el build falla. Mantener la
 * separación estricta.
 */

// ---------------------------------------------------------------
// Queries (server-only)
// ---------------------------------------------------------------

export { findWriteScope, type LibraryCategoryWriteScope } from './server/queries'
