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
// Tipos R.5 retenidos para compat (se replantean en R.7.5+)
// ---------------------------------------------------------------

/**
 * @deprecated R.7: el discriminador `pdf|link|image|doc|sheet` se
 * reemplaza por embed providers en `Post.body` AST. Tipo conservado
 * para que componentes UI R.5 (`<FileIcon>`, `<TypeFilterPills>`)
 * sigan compilando hasta que R.7.5+ los renombre/elimine.
 */
export type DocType = 'pdf' | 'link' | 'image' | 'doc' | 'sheet'

/**
 * @deprecated R.7: reemplazado por `LibraryItem` (R.7.5+).
 * Componentes UI R.5 (`<RecentDocRow>`, `<DocList>`) usan este shape
 * con mock data.
 */
export type LibraryDoc = {
  id: string
  slug: string
  categorySlug: string
  categoryTitle: string
  type: DocType
  title: string
  uploadedAt: Date
  uploadedByDisplayName: string
  url: string
}
