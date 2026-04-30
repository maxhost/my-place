/**
 * Tipos del dominio de Library (R.5).
 *
 * UI-only v1: estos tipos definen el contrato que los componentes UI
 * esperan de los datos. Cuando se sume el backend (R.5.X follow-up),
 * Prisma `LibraryCategory` y `LibraryDoc` se mapean a estos shapes
 * desde queries. Por ahora no hay backend — las pages hardcodean
 * arrays vacíos y los componentes se ejercitan con mock data en
 * tests.
 *
 * Ver `docs/features/library/spec.md`.
 */

/**
 * Categorías visibles del MVP. El handoff define un set abierto
 * (extensible cuando admin pueda crear categorías custom). Por ahora
 * los componentes aceptan cualquier `string` para `emoji` y no
 * validan emoji literal.
 */

/**
 * Tipo de documento — discrimina UI (icono, comportamiento de open).
 *
 * - `pdf`: documento PDF embeddable.
 * - `link`: URL externa (abrir en nueva tab con noopener/noreferrer).
 * - `image`: imagen (preview / sheet full-screen).
 * - `doc`: Google Doc / Word (abrir Workspace tab o descargar).
 * - `sheet`: Google Sheets / Excel.
 *
 * El handoff (PROMPT.md § Doc opening behavior) define cómo se abre
 * cada uno; eso vive en R.5.X cuando exista backend con URLs reales.
 */
export type DocType = 'pdf' | 'link' | 'image' | 'doc' | 'sheet'

/**
 * Categoría de la biblioteca. Aparece en el grid de la zona root y
 * como destino de `/library/[categorySlug]`.
 */
export type LibraryCategory = {
  id: string
  /** Slug único per-place. URL canónica `/library/[slug]`. Inmutable
   *  como Place.slug y Post.slug. */
  slug: string
  /** Emoji Unicode (no clase CSS) — el admin elige al crear. */
  emoji: string
  /** Nombre user-facing. Caps definidos en R.5.X cuando se sume
   *  validación de creación. */
  title: string
  /** Cantidad de docs activos en la categoría. Calculado por el
   *  backend (count) — no se persiste en la categoría. */
  docCount: number
}

/**
 * Documento de la biblioteca. Aparece en `<RecentsList>` (top-N
 * globales) y en `<DocList>` dentro de una categoría.
 */
export type LibraryDoc = {
  id: string
  slug: string
  /** Slug de la categoría a la que pertenece — para `<RecentDocRow>`
   *  poder linkear a la categoría como meta-info. */
  categorySlug: string
  /** Nombre de la categoría — congelado en el snapshot del row para
   *  evitar query extra al renderear. Cuando llegue backend, se
   *  resuelve via JOIN o cache. */
  categoryTitle: string
  type: DocType
  title: string
  uploadedAt: Date
  /** Display name del que subió. Snapshot congelado al momento de
   *  upload — sobrevive erasure 365d (mismo patrón que post.authorSnapshot). */
  uploadedByDisplayName: string
  /** URL externa (`type='link'`) o storage path interno (otros
   *  types). La resolución específica vive en R.5.X cuando se sume
   *  Supabase Storage. */
  url: string
}
