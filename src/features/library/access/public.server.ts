import 'server-only'

/**
 * API pública server-only del sub-slice `library/access`.
 *
 * Queries Prisma + `findReadScope(categoryId)` cacheable. Server Components
 * y pages importan de acá. Client Components importan sólo de
 * `@/features/library/access/public`.
 *
 * Razón del split (gotcha CLAUDE.md): si un Client Component importa
 * `@/features/library/access/public` y este re-exporta queries Prisma con
 * `import 'server-only'`, el build falla. Mantener la separación estricta.
 */

// ---------------------------------------------------------------
// Queries (server-only)
// ---------------------------------------------------------------

export { findReadScope, type LibraryCategoryReadScope } from './server/queries'

// ---------------------------------------------------------------
// Gate de lectura — punto único de verdad (Plan A, Hallazgo #2)
// ---------------------------------------------------------------

export { assertCategoryReadable, canViewCategory } from './server/assert-readable'
