/**
 * API pública del sub-slice `library/items/`.
 *
 * UI + Server Actions del CRUD de items de biblioteca (form, editor,
 * header, admin menu, listing).
 *
 * Boundary: cualquier consumer fuera de items/ (incluido el parent
 * `library/` raíz, siblings `embeds/` / `admin/`, sub-slices `access/`
 * / `courses/`, y pages) importa SOLO desde acá. Imports internos del
 * sub-slice usan paths relativos.
 *
 * Plan: docs/plans/2026-05-04-library-root-sub-split-and-cap-enforcement.md
 * ADR:  docs/decisions/2026-05-04-library-root-sub-split.md
 */

// ---------------------------------------------------------------
// UI components
// ---------------------------------------------------------------

// stub F.1: LibraryItemEditor + LibraryItemForm eliminados. F.4 reintroduce
// el composer Lexical de items desde el slice `rich-text/`.
export { EmptyItemList } from './ui/empty-item-list'
export { ItemAdminMenu } from './ui/item-admin-menu'
export { ItemList } from './ui/item-list'
export { LibraryItemHeader } from './ui/library-item-header'
export { LibraryItemHeaderBar } from './ui/library-item-header-bar'

// ---------------------------------------------------------------
// Server Actions (referencias `'use server'` viajan client-safe)
// ---------------------------------------------------------------

export { archiveLibraryItemAction } from './server/actions/archive-item'
export { createLibraryItemAction } from './server/actions/create-item'
export { updateLibraryItemAction } from './server/actions/update-item'
