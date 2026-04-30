/**
 * Tipos del dominio de Library.
 *
 * R.5: tipos UI-only (componentes con mock data).
 * R.7.2: tipos finales que matchean el schema Prisma + contribution
 * policy + designated contributors.
 *
 * Los tipos son puros — sin Prisma, sin Next. Las queries del slice
 * mapean rows de Prisma a estos shapes.
 *
 * Ver `docs/features/library/spec.md` § 2 + § 10.
 */

/**
 * Política de contribución por categoría.
 *
 * - `ADMIN_ONLY`: solo admin/owner del place crea items (default seguro).
 * - `DESIGNATED`: admin + miembros listados en
 *   `LibraryCategoryContributor`.
 * - `MEMBERS_OPEN`: cualquier miembro activo del place.
 *
 * Mapea 1:1 al enum Postgres `ContributionPolicy`.
 */
export type ContributionPolicy = 'ADMIN_ONLY' | 'DESIGNATED' | 'MEMBERS_OPEN'

export const CONTRIBUTION_POLICY_VALUES: ReadonlyArray<ContributionPolicy> = [
  'ADMIN_ONLY',
  'DESIGNATED',
  'MEMBERS_OPEN',
]

/**
 * Categoría de la biblioteca. Aparece en el grid de la zona root y
 * como destino de `/library/[categorySlug]`.
 *
 * `docCount` se calcula por la query (no se persiste). En R.7.5+ pasa
 * a contar `LibraryItem` no archivados; en R.7.2 (sin items todavía) la
 * query devuelve 0 siempre.
 */
export type LibraryCategory = {
  id: string
  /** Slug único per-place. URL canónica `/library/[slug]`. Inmutable. */
  slug: string
  /** Emoji Unicode (no clase CSS). 1..8 chars (CHECK constraint). */
  emoji: string
  /** Nombre user-facing. 1..60 chars (CHECK + invariant). */
  title: string
  /** Posición manual. NULL hasta que admin reordena. La query ordena
   *  COALESCE(position, +Infinity) → createdAt como fallback. */
  position: number | null
  contributionPolicy: ContributionPolicy
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
  /** Cantidad de items activos. Calculado por la query (sub-count).
   *  R.7.2 retorna 0; cuando R.7.5+ sume LibraryItem, refleja el real. */
  docCount: number
}

/**
 * Vista de un contribuidor designado para una categoría.
 *
 * `displayName` y `avatarUrl` se resuelven via JOIN a `User` para
 * renderizar la lista en el admin sin queries N+1.
 */
export type LibraryCategoryContributor = {
  categoryId: string
  userId: string
  displayName: string
  avatarUrl: string | null
  invitedAt: Date
  invitedByUserId: string
  invitedByDisplayName: string
}

// ---------------------------------------------------------------
// LibraryItem (R.7.5+)
// ---------------------------------------------------------------

/**
 * Snapshot del author del item — el shape se hereda del Post asociado
 * (Post.authorSnapshot). Se renombra a "ex-miembro" tras erasure 365d.
 * Definido localmente para no depender del slice discussions desde
 * domain/types.ts (que es puro).
 */
export type ItemAuthorSnapshot = {
  displayName: string
  avatarUrl: string | null
}

/**
 * Vista de listado: una row del item para `<LibraryItemRow>` (R.7).
 * Combina LibraryItem + Post.title + Post.lastActivityAt + Post.slug
 * + author snapshot — el thread documento ES el item.
 */
export type LibraryItemListView = {
  id: string
  postId: string
  postSlug: string
  /** Slug de la categoría — para construir URL canónica
   *  `/library/[categorySlug]/[postSlug]`. */
  categorySlug: string
  categoryEmoji: string
  categoryTitle: string
  title: string
  /** Cover guardado en DB; mobile no renderiza, desktop futuro sí. */
  coverUrl: string | null
  /** Para la mini-card mobile. Display del author. */
  authorUserId: string | null
  authorDisplayName: string
  /** Última actividad del Post (createdAt si nunca tuvo comments). */
  lastActivityAt: Date
  /** Cantidad de comments del Post — útil para "n respuestas". */
  commentCount: number
}

/**
 * Vista detalle: el item con todo lo que necesita la page
 * `/library/[categorySlug]/[itemSlug]` para renderizar header +
 * cuerpo TipTap + meta. Comments y reactions vienen de las queries
 * de discussions.
 */
export type LibraryItemDetailView = {
  id: string
  placeId: string
  categoryId: string
  categorySlug: string
  categoryEmoji: string
  categoryTitle: string
  postId: string
  postSlug: string
  title: string
  /** AST TipTap del Post.body. */
  body: unknown
  coverUrl: string | null
  authorUserId: string | null
  authorSnapshot: ItemAuthorSnapshot
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
  postCreatedAt: Date
  postLastActivityAt: Date
}
