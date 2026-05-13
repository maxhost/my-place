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
 * - `DESIGNATED`: admin + miembros listados en
 *   `LibraryCategoryContributor`.
 * - `MEMBERS_OPEN`: cualquier miembro activo del place (default).
 * - `SELECTED_GROUPS`: miembros que pertenezcan a alguno de los
 *   `PermissionGroup` con scope a esta categoría (via `GroupCategoryScope`).
 *
 * `ADMIN_ONLY` fue eliminado (migration 20260504010000) — ver
 * `docs/decisions/2026-05-04-library-contribution-policy-groups.md`.
 *
 * Mapea 1:1 al enum Postgres `ContributionPolicy`.
 */
export type ContributionPolicy = 'DESIGNATED' | 'MEMBERS_OPEN' | 'SELECTED_GROUPS'

export const CONTRIBUTION_POLICY_VALUES: ReadonlyArray<ContributionPolicy> = [
  'DESIGNATED',
  'MEMBERS_OPEN',
  'SELECTED_GROUPS',
]

/**
 * Tipo de categoría (G.1, 2026-05-04).
 *
 * - `GENERAL`: contenido regular (default).
 * - `COURSE`: items pueden declarar prereqs y los viewers marcarlos como
 *   completados (tracking privado en `LibraryItemCompletion`).
 *
 * Mapea 1:1 al enum Postgres `LibraryCategoryKind`. Ver
 * `docs/decisions/2026-05-04-library-courses-and-read-access.md`.
 */
export type LibraryCategoryKind = 'GENERAL' | 'COURSE'

export const LIBRARY_CATEGORY_KIND_VALUES: ReadonlyArray<LibraryCategoryKind> = [
  'GENERAL',
  'COURSE',
]

/**
 * Discriminator del scope de lectura (G.1, 2026-05-04).
 *
 * - `PUBLIC`: cualquier miembro activo del place lee (default).
 * - `GROUPS`: sólo users en alguno de los `PermissionGroup` listados en
 *   `LibraryCategoryGroupReadScope` para esta categoría.
 * - `TIERS`: sólo users con `TierMembership` activa a alguno de los tiers
 *   listados en `LibraryCategoryTierReadScope`.
 * - `USERS`: sólo los users individuales listados en
 *   `LibraryCategoryUserReadScope`.
 *
 * Mapea 1:1 al enum Postgres `LibraryReadAccessKind`.
 */
export type LibraryReadAccessKind = 'PUBLIC' | 'GROUPS' | 'TIERS' | 'USERS'

export const LIBRARY_READ_ACCESS_KIND_VALUES: ReadonlyArray<LibraryReadAccessKind> = [
  'PUBLIC',
  'GROUPS',
  'TIERS',
  'USERS',
]

/**
 * Discriminator del scope de ESCRITURA (S1a, 2026-05-12).
 *
 * - `OWNER_ONLY`: sólo owner del place puede crear items (default
 *   restrictivo).
 * - `GROUPS`: sólo users en alguno de los `PermissionGroup` listados en
 *   `LibraryCategoryGroupWriteScope` para esta categoría.
 * - `TIERS`: sólo users con `TierMembership` activa a alguno de los tiers
 *   listados en `LibraryCategoryTierWriteScope`.
 * - `USERS`: sólo los users individuales listados en
 *   `LibraryCategoryUserWriteScope`.
 *
 * Reemplaza al legacy `ContributionPolicy`. Mapea 1:1 al enum Postgres
 * `WriteAccessKind`. Ver ADR
 * `docs/decisions/2026-05-12-library-permissions-model.md`.
 */
export type WriteAccessKind = 'OWNER_ONLY' | 'GROUPS' | 'TIERS' | 'USERS'

export const WRITE_ACCESS_KIND_VALUES: ReadonlyArray<WriteAccessKind> = [
  'OWNER_ONLY',
  'GROUPS',
  'TIERS',
  'USERS',
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
  /** FK al Place owner. Necesario para validar pertenencia cross-place al
   *  hacer deep-link a `/<slug>.place.community/settings/library/[categoryId]`
   *  desde el admin de otro place (security check). */
  placeId: string
  /** Slug único per-place. URL canónica `/library/[slug]`. Inmutable. */
  slug: string
  /** Emoji Unicode (no clase CSS). 1..8 chars (CHECK constraint). */
  emoji: string
  /** Nombre user-facing. 1..60 chars (CHECK + invariant). */
  title: string
  /** Posición manual. NULL hasta que admin reordena. La query ordena
   *  COALESCE(position, +Infinity) → createdAt como fallback. */
  position: number | null
  /** LEGACY (a eliminar en S1b): reemplazado por `writeAccessKind`. */
  contributionPolicy: ContributionPolicy
  /** G.1 (2026-05-04): tipo de categoría. Default GENERAL. */
  kind: LibraryCategoryKind
  /** G.1 (2026-05-04): discriminator del scope de lectura. Default PUBLIC. */
  readAccessKind: LibraryReadAccessKind
  /** S1a (2026-05-12): discriminator del scope de escritura. Default
   *  OWNER_ONLY. Reemplaza a `contributionPolicy`. */
  writeAccessKind: WriteAccessKind
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
  /** Cantidad de items activos. Calculado por la query (sub-count).
   *  R.7.2 retorna 0; cuando R.7.5+ sume LibraryItem, refleja el real. */
  docCount: number
  /** LEGACY (a eliminar en S1b): group ids con scope a esta categoría
   *  (via `GroupCategoryScope`). Vacío salvo cuando
   *  `contributionPolicy === 'SELECTED_GROUPS'`. */
  groupScopeIds: string[]
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
  /** G.1 (2026-05-04): item prereq (single, opt-in) para courses. NULL
   *  cuando la categoría es GENERAL o el item no declara prereq. */
  prereqItemId: string | null
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
  /** Versión del Post — usada por `updateItemAction` como `expectedVersion`
   *  para optimistic concurrency. */
  postVersion: number
  coverUrl: string | null
  authorUserId: string | null
  authorSnapshot: ItemAuthorSnapshot
  /** G.1 (2026-05-04): item prereq (single) para courses. */
  prereqItemId: string | null
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
  postCreatedAt: Date
  postLastActivityAt: Date
}
