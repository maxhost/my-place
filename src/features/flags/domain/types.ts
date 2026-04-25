/**
 * Tipos puros del slice `flags`. Sin Next, React ni queries.
 *
 * Los enums se re-exportan directamente del Prisma client. La entidad `Flag`
 * es polimórfica: apunta a `POST` o `COMMENT` via (`targetType`, `targetId`).
 *
 * Ver `docs/features/discussions/spec.md` § 10 (moderación) y
 * `docs/decisions/2026-04-21-flags-subslice-split.md`.
 */

import type {
  ContentTargetKind as PrismaContentTargetKind,
  FlagReason as PrismaFlagReason,
  FlagStatus as PrismaFlagStatus,
} from '@prisma/client'

export type ContentTargetKind = PrismaContentTargetKind
export type FlagReason = PrismaFlagReason
export type FlagStatus = PrismaFlagStatus

export {
  ContentTargetKind as ContentTargetKindValues,
  FlagReason as FlagReasonValues,
  FlagStatus as FlagStatusValues,
} from '@prisma/client'

export type FlagId = string

/** Entidad persistida tal como la mapea `server/queries.ts`. */
export type Flag = {
  id: FlagId
  targetType: ContentTargetKind
  targetId: string
  placeId: string
  reporterUserId: string
  reason: FlagReason
  reasonNote: string | null
  status: FlagStatus
  createdAt: Date
  reviewedAt: Date | null
  reviewerAdminUserId: string | null
  reviewNote: string | null
}

/**
 * Snapshot del contenido reportado (post o comment) resuelto en batch por
 * `listFlagTargetSnapshots`. Si el target fue eliminado entre el flag y el
 * review, el batch no lo incluye y el consumidor recibe `null`.
 */
export type FlagTargetSnapshot =
  | {
      targetType: 'POST'
      targetId: string
      title: string
      body: unknown
      hiddenAt: Date | null
      slug: string
    }
  | {
      targetType: 'COMMENT'
      targetId: string
      body: unknown
      deletedAt: Date | null
      postId: string
      /** Slug del post padre para construir links; null si el post padre ya no existe. */
      postSlug: string | null
    }
  | {
      // Eventos reportables (F.C Fase 6 — PR-2). Ver
      // docs/features/events/spec-integrations.md § 4.4 para la firma exacta.
      targetType: 'EVENT'
      targetId: string
      title: string
      authorSnapshot: { displayName: string; avatarUrl: string | null }
      /** ISO 8601 UTC. */
      startsAt: string
      /** IANA del evento (la "intención" del autor; el viewer puede vivir en otro huso). */
      timezone: string
      /** ISO 8601 si el evento fue cancelado, null si está activo. */
      cancelledAt: string | null
    }

/** Estado narrativo del contenido al momento del render de la cola admin. */
export type FlagContentStatus = 'VISIBLE' | 'HIDDEN' | 'DELETED'

/**
 * View "enriquecida" del flag para la cola admin: combina el flag + snapshot
 * del target (preview de texto plano, título en POST, `contentStatus`).
 */
export type FlagView = {
  id: FlagId
  targetType: ContentTargetKind
  targetId: string
  reason: FlagReason
  reasonNote: string | null
  createdAt: Date
  reporterUserId: string
  status: FlagStatus
  reviewedAt: Date | null
  reviewNote: string | null
  contentStatus: FlagContentStatus
  /** Title del Post si aplica; null en comments o target deleted. */
  title: string | null
  /** Plain-text excerpt del body, truncado a ~160 chars. Vacío si deleted. */
  preview: string
  /** Slug del post para construir links; null si COMMENT + target deleted. */
  postSlug: string | null
  /** Postre para links en COMMENT. */
  postId: string | null
}
