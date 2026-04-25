/**
 * Tipos del job de erasure 365d (C.L). Privados al sub-slice
 * `features/members/server/erasure/`.
 */

export type ErasureRunResult = {
  dryRun: boolean
  membershipsProcessed: number
  postsAnonymized: number
  commentsAnonymized: number
  /**
   * Cantidad de eventos cuyo `authorUserId` fue nullificado + `authorSnapshot.displayName`
   * renombrado a "ex-miembro". F.C Fase 6 (PR-3) — ver
   * `docs/features/events/spec-integrations.md § 3`.
   */
  eventsAnonymized: number
  /**
   * Cantidad de RSVPs DELETEadas del ex-miembro **sólo en el place que dejó**
   * (no global). Si el user sigue activo en otros places, sus RSVPs allá se
   * preservan. F.C Fase 6 (PR-3).
   */
  rsvpsDeleted: number
  errorsPerMembership: Array<{ membershipId: string; error: string }>
}

export type ErasureMembershipCounts = {
  posts: number
  comments: number
  events: number
  rsvpsDeleted: number
}

/**
 * Shape del array `snapshotsBefore` en `ErasureAuditLog`. Cada entrada
 * captura la identidad ANTES del rename — permite rollback manual.
 */
export type ErasureSnapshotBeforeEntry = {
  type: 'POST' | 'COMMENT' | 'EVENT'
  id: string
  displayName: string
  avatarUrl: string | null
}
