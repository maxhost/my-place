/**
 * API pública del slice `library` (R.5 — UI scaffold v1).
 *
 * Sin queries server-side todavía (decisión user 2026-04-30: solo
 * UI; cuando exista backend, se agrega `server/queries.ts` y se
 * extiende este barrel con el split `public.server.ts` si hace
 * falta).
 *
 * Ver `docs/features/library/spec.md` y `docs/architecture.md`
 * § boundaries.
 */

// Domain types — contrato que la UI espera del futuro backend
export type { DocType, LibraryCategory, LibraryDoc } from './domain/types'

// UI components — Server Components salvo `<TypeFilterPills>`
export { CategoryCard } from './ui/category-card'
export { CategoryGrid } from './ui/category-grid'
export { CategoryHeaderBar } from './ui/category-header-bar'
export { DocList } from './ui/doc-list'
export { EmptyDocList } from './ui/empty-doc-list'
export { EmptyLibrary } from './ui/empty-library'
export { FileIcon } from './ui/file-icon'
export { LibrarySectionHeader } from './ui/library-section-header'
export { RecentDocRow } from './ui/recent-doc-row'
export { RecentsList } from './ui/recents-list'
export { TypeFilterPills } from './ui/type-filter-pills'
